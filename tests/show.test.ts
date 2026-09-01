import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { createJob, updateJobStatus } from '../src/db/jobs.js';
import { showCommand } from '../src/cli/commands/show.js';

describe('Show Command', () => {
  let db: Database.Database;
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-show-test-'));
    process.env.CQ_HOME = tempDir;
    process.env.CQ_DB_PATH = path.join(tempDir, 'test.db');
    process.env.CQ_LOGS_DIR = path.join(tempDir, 'logs');
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

  it('displays full details for a job', async () => {
    const job = createJob(
      {
        prompt: 'Refactor database models with TypeScript',
        repo_path: '/path/to/project',
        priority: 'high',
      },
      db
    );

    updateJobStatus(
      job.id,
      'waiting_limit',
      {
        attempts: 2,
        next_attempt_at: '2026-09-01T20:10:00.000Z',
        failure_kind: 'usage_limit',
        last_error: 'Usage limit reached. Try again at 8:09 PM.',
        thread_id: 'thread-12345',
        started_at: '2026-09-01T18:31:02.000Z',
      },
      db
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await showCommand(String(job.id), db);

    expect(logSpy).toHaveBeenCalled();
    const allOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

    expect(allOutput).toContain(`Job #${job.id}`);
    expect(allOutput).toContain('waiting_limit');
    expect(allOutput).toContain('high');
    expect(allOutput).toContain('/path/to/project');
    expect(allOutput).toContain('Refactor database models with TypeScript');
    expect(allOutput).toContain('usage_limit');
    expect(allOutput).toContain('thread-12345');
    expect(allOutput).toContain('Usage limit reached');

    logSpy.mockRestore();
  });
});
