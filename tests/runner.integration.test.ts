import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { createJob, getJobById } from '../src/db/jobs.js';
import { CodexRunner } from '../src/runner/codex-runner.js';

describe('CodexRunner process integration', () => {
  let db: Database.Database;
  let tempDir: string;
  let fakeCodexPath: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-runner-integration-'));
    process.env.CQ_HOME = tempDir;
    process.env.CQ_DB_PATH = path.join(tempDir, 'test.db');
    process.env.CQ_LOGS_DIR = path.join(tempDir, 'logs');
    fs.mkdirSync(process.env.CQ_LOGS_DIR, { recursive: true });
    db = initDatabase(':memory:');

    fakeCodexPath = path.join(tempDir, 'fake-codex.mjs');
    fs.copyFileSync(path.join(process.cwd(), 'tests/fixtures/fake-codex.mjs'), fakeCodexPath);
    fs.chmodSync(fakeCodexPath, 0o755);
  });

  afterEach(() => {
    closeDatabase();
    db.close();
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes a real child process and persists the created session', async () => {
    const job = createJob({ prompt: 'Run the integration task', repo_path: process.cwd() }, db);
    const result = await new CodexRunner(db).run(job, {
      codexBin: fakeCodexPath,
      env: { CQ_FAKE_CODEX_MODE: 'success' },
    });

    expect(result.status).toBe('completed');
    expect(result.threadId).toBe('fake-session-created');
    expect(getJobById(job.id, db)?.status).toBe('completed');
    expect(getJobById(job.id, db)?.thread_id).toBe('fake-session-created');
  });

  it('resumes the persisted session after a usage limit', async () => {
    const job = createJob({ prompt: 'Continue the long task', session_id: 'fake-session-existing' }, db);
    const runner = new CodexRunner(db);

    process.env.CQ_FAKE_CODEX_MODE = 'usage-limit';
    const limited = await runner.run(job, { codexBin: fakeCodexPath });
    expect(limited.failureKind).toBe('usage_limit');
    expect(getJobById(job.id, db)?.status).toBe('waiting_limit');

    process.env.CQ_FAKE_CODEX_MODE = 'success';
    const resumedJob = getJobById(job.id, db)!;
    const events: unknown[] = [];
    const resumed = await runner.run(resumedJob, {
      codexBin: fakeCodexPath,
      onEvent: (event) => events.push(event),
    });

    expect(resumed.status).toBe('completed');
    expect(resumed.threadId).toBe('fake-session-existing');
    expect(events).toContainEqual({
      type: 'fake.invocation',
      is_resume: true,
      prompt: 'Continue where you left off.',
    });
    expect(getJobById(job.id, db)?.status).toBe('completed');
  });
});
