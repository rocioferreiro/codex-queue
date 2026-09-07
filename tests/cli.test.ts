import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../src/cli/index.js';
import { closeDatabase, initDatabase } from '../src/db/client.js';
import { listJobs, getJobById } from '../src/db/jobs.js';

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
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup race
    }
    vi.restoreAllMocks();
  });

  it('adds a job with high priority via CLI', async () => {
    const program = createProgram();
    program.exitOverride();

    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'cq',
      'add',
      'Build high prio feature',
      '--priority',
      'high',
      '--codex-home',
      '/sessions/work',
    ]);

    const jobs = listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].prompt).toBe('Build high prio feature');
    expect(jobs[0].priority).toBe(10);
    expect(jobs[0].codex_home).toBe('/sessions/work');
    expect(jobs[0].status).toBe('pending');
  });

  it('adds a job scheduled with --at', async () => {
    const program = createProgram();
    program.exitOverride();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'cq',
      'add',
      'Scheduled task',
      '--at',
      '2026-09-07T10:00:00-03:00',
    ]);

    expect(listJobs()[0].next_attempt_at).toBe('2026-09-07T13:00:00.000Z');
  });

  it('changes a job next attempt with schedule', async () => {
    const addProgram = createProgram();
    addProgram.exitOverride();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await addProgram.parseAsync(['node', 'cq', 'add', 'Reschedule me']);

    const jobId = listJobs()[0].id;
    const scheduleProgram = createProgram();
    scheduleProgram.exitOverride();
    await scheduleProgram.parseAsync([
      'node',
      'cq',
      'schedule',
      String(jobId),
      '--at',
      '2026-09-07T11:30:00-03:00',
    ]);

    expect(getJobById(jobId)?.next_attempt_at).toBe('2026-09-07T14:30:00.000Z');
  });

  it('adds verified image attachments via CLI', async () => {
    const imagePath = path.join(tempDir, 'screen.png');
    fs.writeFileSync(imagePath, 'not really an image');
    const program = createProgram();
    program.exitOverride();

    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'cq',
      'add',
      'Inspect screen',
      '--image',
      imagePath,
      '--image',
      imagePath,
    ]);

    expect(listJobs()[0].image_paths).toEqual([imagePath, imagePath]);
  });

  it('queues a prompt in an existing session via --session-id', async () => {
    const program = createProgram();
    program.exitOverride();

    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'cq',
      'add',
      'Continue existing work',
      '--session-id',
      'session-123',
    ]);

    expect(listJobs()[0].thread_id).toBe('session-123');
  });

  it('queues the default continuation with the resume command', async () => {
    const program = createProgram();
    program.exitOverride();

    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'cq', 'resume', 'session-456']);

    const job = listJobs()[0];
    expect(job.thread_id).toBe('session-456');
    expect(job.prompt).toBe('Continue where you left off.');
  });

  it('cancels a pending job via CLI cancel command', async () => {
    const program = createProgram();
    program.exitOverride();

    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Add first
    await program.parseAsync(['node', 'cq', 'add', 'Task to cancel']);
    const jobs = listJobs();
    const jobId = jobs[0].id;

    // Cancel
    const cancelProg = createProgram();
    cancelProg.exitOverride();
    await cancelProg.parseAsync(['node', 'cq', 'cancel', String(jobId)]);

    const cancelled = getJobById(jobId);
    expect(cancelled?.status).toBe('cancelled');
  });

  it('lists jobs with formatted columns', async () => {
    const program = createProgram();
    program.exitOverride();

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'cq', 'add', 'Job 1', '-p', 'high']);
    await program.parseAsync(['node', 'cq', 'add', 'Job 2', '-p', 'low']);

    const listProg = createProgram();
    listProg.exitOverride();
    await listProg.parseAsync(['node', 'cq', 'list']);

    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('configures and uses a named Codex session alias', async () => {
    const configureProgram = createProgram();
    configureProgram.exitOverride();

    vi.spyOn(console, 'log').mockImplementation(() => {});

    await configureProgram.parseAsync([
      'node',
      'cq',
      'alias',
      'set',
      'codexwork',
      '--codex-home',
      '/sessions/work',
    ]);

    const addProgram = createProgram();
    addProgram.exitOverride();
    await addProgram.parseAsync(['node', 'cq', 'add', 'Use work session', '--codexwork']);

    const jobs = listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].codex_home).toBe('/sessions/work');
  });

  it('allows a resume job to use a named Codex session alias', async () => {
    const configureProgram = createProgram();
    configureProgram.exitOverride();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await configureProgram.parseAsync([
      'node',
      'cq',
      'alias',
      'set',
      'codexwork',
      '--codex-home',
      '/sessions/work',
    ]);

    const resumeProgram = createProgram();
    resumeProgram.exitOverride();
    await resumeProgram.parseAsync(['node', 'cq', 'resume', 'session-789', '--codexwork']);

    const job = listJobs()[0];
    expect(job.thread_id).toBe('session-789');
    expect(job.codex_home).toBe('/sessions/work');
  });
});
