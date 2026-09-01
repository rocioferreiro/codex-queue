import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { createJob } from '../src/db/jobs.js';
import { logsCommand } from '../src/cli/commands/logs.js';
import { getJobLogPath, getWorkerLogPath } from '../src/storage/paths.js';

describe('Logs Command', () => {
  let db: Database.Database;
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-logs-test-'));
    process.env.CQ_HOME = tempDir;
    process.env.CQ_DB_PATH = path.join(tempDir, 'test.db');
    process.env.CQ_LOGS_DIR = path.join(tempDir, 'logs');
    fs.mkdirSync(process.env.CQ_LOGS_DIR, { recursive: true });
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
    db.close();
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('pretty-prints parsed JSONL events for a job', async () => {
    const job = createJob({ prompt: 'Test logs' }, db);
    const logPath = getJobLogPath(job.id);

    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-abc' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.failed', error: { message: 'Limit reached' } }),
    ].join('\n');

    fs.writeFileSync(logPath, jsonl);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await logsCommand(String(job.id), {});

    expect(logSpy).toHaveBeenCalled();
    const allOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

    expect(allOutput).toContain('thread started');
    expect(allOutput).toContain('thread-abc');
    expect(allOutput).toContain('turn started');
    expect(allOutput).toContain('turn failed: Limit reached');

    logSpy.mockRestore();
  });

  it('outputs raw JSONL when --raw flag is specified', async () => {
    const job = createJob({ prompt: 'Test raw logs' }, db);
    const logPath = getJobLogPath(job.id);
    const rawContent = '{"type":"thread.started","thread_id":"123"}\n{"type":"turn.started"}';
    fs.writeFileSync(logPath, rawContent);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await logsCommand(String(job.id), { raw: true });

    const allOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allOutput).toContain('{"type":"thread.started","thread_id":"123"}');
    expect(allOutput).toContain('{"type":"turn.started"}');

    logSpy.mockRestore();
  });

  it('reads worker log when target is "worker"', async () => {
    const workerLogPath = getWorkerLogPath();
    fs.writeFileSync(workerLogPath, 'codex-queue worker started\njob #1 starting\n');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await logsCommand('worker', {});

    const allOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allOutput).toContain('codex-queue worker started');
    expect(allOutput).toContain('job #1 starting');

    logSpy.mockRestore();
  });
});
