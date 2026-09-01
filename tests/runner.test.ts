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
}

function createMockChildProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
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
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
    db.close();
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('spawns codex with shell=false and exact arguments', async () => {
    const job = createJob({ prompt: 'Implement login', repo_path: '/my/workspace' }, db);

    let spawnedCommand = '';
    let spawnedArgs: string[] = [];
    let spawnedOptions: unknown = null;

    const mockProc = createMockChildProcess();

    const mockSpawn = (command: string, args: readonly string[], options: unknown) => {
      spawnedCommand = command;
      spawnedArgs = [...args];
      spawnedOptions = options;

      // Simulate output and exit
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

    expect(result.exitCode).toBe(0);
    expect(result.threadId).toBe('th_mock_999');
    expect(detectedThread).toBe('th_mock_999');

    const updatedJob = getJobById(job.id, db);
    expect(updatedJob?.status).toBe('completed');
    expect(updatedJob?.thread_id).toBe('th_mock_999');
    expect(updatedJob?.exit_code).toBe(0);
    expect(updatedJob?.completed_at).toBeDefined();

    // Verify log file content
    const logs = readJobLog(job.id);
    expect(logs).toContain('th_mock_999');
  });

  it('handles non-zero exit code as failed job', async () => {
    const job = createJob({ prompt: 'Failing task', repo_path: '/workspace' }, db);
    const mockProc = createMockChildProcess();

    const mockSpawn = () => {
      setTimeout(() => {
        mockProc.stderr.write('Something went wrong in Codex\n');
        mockProc.emit('close', 1);
      }, 10);
      return mockProc as any;
    };

    const runner = new CodexRunner(db);
    const result = await runner.run(job, {
      spawnFn: mockSpawn as any,
    });

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain('Something went wrong in Codex');

    const updatedJob = getJobById(job.id, db);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.exit_code).toBe(1);
    expect(updatedJob?.error_message).toContain('Something went wrong in Codex');
  });

  it('handles child process spawn errors gracefully', async () => {
    const job = createJob({ prompt: 'Error task', repo_path: '/workspace' }, db);
    const mockProc = createMockChildProcess();

    const mockSpawn = () => {
      setTimeout(() => {
        mockProc.emit('error', new Error('spawn ENOENT'));
      }, 10);
      return mockProc as any;
    };

    const runner = new CodexRunner(db);
    const result = await runner.run(job, {
      spawnFn: mockSpawn as any,
    });

    expect(result.exitCode).toBe(-1);
    expect(result.errorMessage).toBe('spawn ENOENT');

    const updatedJob = getJobById(job.id, db);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.error_message).toBe('spawn ENOENT');
  });
});
