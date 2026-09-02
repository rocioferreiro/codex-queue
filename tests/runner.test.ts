import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { createJob, getJobById } from '../src/db/jobs.js';
import { CodexRunner } from '../src/runner/codex-runner.js';
import { readJobLog } from '../src/storage/logs.js';

interface MockChildProcess extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  killed?: boolean;
  kill: (signal?: string) => void;
}

function createMockChildProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = (signal = 'SIGTERM') => {
    proc.killed = true;
    proc.emit('close', null, signal);
  };
  return proc;
}

describe('CodexRunner', () => {
  let db: Database.Database;
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-runner-test-'));
    process.env.CQ_HOME = tempDir;
    process.env.CQ_DB_PATH = path.join(tempDir, 'test.db');
    process.env.CQ_LOGS_DIR = path.join(tempDir, 'logs');
    fs.mkdirSync(process.env.CQ_LOGS_DIR, { recursive: true });
    db = initDatabase(':memory:');
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 20));
    closeDatabase();
    db.close();
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup race
    }
  });

  it('spawns codex with shell=false and exact arguments', async () => {
    const job = createJob({
      prompt: 'Implement login',
      repo_path: '/my/workspace',
      codex_home: '/sessions/work',
    }, db);

    let spawnedCommand = '';
    let spawnedArgs: string[] = [];
    let spawnedOptions: unknown = null;

    const mockProc = createMockChildProcess();

    const mockSpawn = (command: string, args: readonly string[], options: unknown) => {
      spawnedCommand = command;
      spawnedArgs = [...args];
      spawnedOptions = options;

      setTimeout(() => {
        mockProc.stdout.write('{"type":"thread.created","thread_id":"th_mock_999"}\n');
        mockProc.stdout.write('{"type":"turn.completed"}\n');
        mockProc.emit('close', 0);
      }, 10);

      return mockProc as any;
    };

    const runner = new CodexRunner(db);
    let detectedThread: string | null = null;

    const result = await runner.run(job, {
      spawnFn: mockSpawn as any,
      onThreadId: (th) => {
        detectedThread = th;
      },
    });

    expect(spawnedCommand).toBe('codex');
    expect(spawnedArgs).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '-C',
      '/my/workspace',
      'Implement login',
    ]);
    expect((spawnedOptions as any).shell).toBe(false);
    expect((spawnedOptions as any).env.CODEX_HOME).toBe('/sessions/work');

    expect(result.exitCode).toBe(0);
    expect(result.threadId).toBe('th_mock_999');
    expect(detectedThread).toBe('th_mock_999');

    const updatedJob = getJobById(job.id, db);
    expect(updatedJob?.status).toBe('completed');
    expect(updatedJob?.thread_id).toBe('th_mock_999');
    expect(updatedJob?.exit_code).toBe(0);
    expect(updatedJob?.completed_at).toBeDefined();

    const logs = readJobLog(job.id);
    expect(logs).toContain('th_mock_999');
  });

  it('passes attached images as Codex image arguments', async () => {
    const imagePath = path.join(tempDir, 'error.png');
    fs.writeFileSync(imagePath, 'not really an image');
    const job = createJob({
      prompt: 'Inspect these screenshots',
      repo_path: '/my/workspace',
      image_paths: [imagePath, imagePath],
    }, db);
    const mockProc = createMockChildProcess();
    let spawnedArgs: string[] = [];

    const mockSpawn = (_command: string, args: readonly string[]) => {
      spawnedArgs = [...args];
      setTimeout(() => mockProc.emit('close', 0), 10);
      return mockProc as any;
    };

    await new CodexRunner(db).run(job, { spawnFn: mockSpawn as any });

    expect(spawnedArgs).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--image',
      imagePath,
      '--image',
      imagePath,
      '-C',
      '/my/workspace',
      'Inspect these screenshots',
    ]);
  });

  it('transitions to waiting_limit when usage limit is detected', async () => {
    const job = createJob({ prompt: 'Limit test task', repo_path: '/workspace' }, db);
    const mockProc = createMockChildProcess();

    const mockSpawn = () => {
      setTimeout(() => {
        mockProc.stderr.write("You've hit your usage limit. Try again at Sep 1st, 2026 5:32 PM\n");
        mockProc.emit('close', 1);
      }, 10);
      return mockProc as any;
    };

    const runner = new CodexRunner(db);
    const result = await runner.run(job, {
      spawnFn: mockSpawn as any,
      referenceDate: new Date('2026-09-01T12:00:00.000Z'),
    });

    expect(result.failureKind).toBe('usage_limit');

    const updatedJob = getJobById(job.id, db);
    expect(updatedJob?.status).toBe('waiting_limit');
    expect(updatedJob?.failure_kind).toBe('usage_limit');
    expect(updatedJob?.next_attempt_at).toBeDefined();
    expect(updatedJob?.attempts).toBe(1);
  });

  it('handles non-zero exit code as failed job when error is unknown', async () => {
    const job = createJob({ prompt: 'Failing task', repo_path: '/workspace' }, db);
    const mockProc = createMockChildProcess();

    const mockSpawn = () => {
      setTimeout(() => {
        mockProc.stderr.write('Something unexpected failed in Codex\n');
        mockProc.emit('close', 1);
      }, 10);
      return mockProc as any;
    };

    const runner = new CodexRunner(db);
    const result = await runner.run(job, {
      spawnFn: mockSpawn as any,
    });

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain('Something unexpected failed in Codex');

    const updatedJob = getJobById(job.id, db);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.exit_code).toBe(1);
    expect(updatedJob?.error_message).toContain('Something unexpected failed in Codex');
  });

  it('allows aborting active child process', async () => {
    const job = createJob({ prompt: 'Long task', repo_path: '/workspace' }, db);
    const mockProc = createMockChildProcess();

    const mockSpawn = () => mockProc as any;

    const runner = new CodexRunner(db);
    const runPromise = runner.run(job, {
      spawnFn: mockSpawn as any,
    });

    runner.abort();
    expect(mockProc.killed).toBe(true);

    const result = await runPromise;
    expect(result.jobId).toBe(job.id);
  });
});
