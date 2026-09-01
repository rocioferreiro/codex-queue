import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../src/cli/index.js';
import { closeDatabase, initDatabase } from '../src/db/client.js';
import { listJobs } from '../src/db/jobs.js';

describe('CLI Integration', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-test-'));
    process.env.CQ_HOME = tempDir;
    process.env.CQ_DB_PATH = path.join(tempDir, 'test.db');
    process.env.CQ_LOGS_DIR = path.join(tempDir, 'logs');
    closeDatabase();
    initDatabase(process.env.CQ_DB_PATH);
  });

  afterEach(() => {
    closeDatabase();
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('adds a job to the queue via CLI add command', async () => {
    const program = createProgram();
    program.exitOverride();

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'cq', 'add', 'Build documentation website']);

    const jobs = listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].prompt).toBe('Build documentation website');
    expect(jobs[0].status).toBe('pending');
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('lists jobs in the queue via CLI list command', async () => {
    const program = createProgram();
    program.exitOverride();

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Add first
    await program.parseAsync(['node', 'cq', 'add', 'Job A']);

    // List
    const listProg = createProgram();
    listProg.exitOverride();
    await listProg.parseAsync(['node', 'cq', 'list']);

    expect(consoleLogSpy).toHaveBeenCalled();
  });
});
