import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { createJob, getJobById, updateJobStatus } from '../src/db/jobs.js';
import { QueueWorker } from '../src/worker/worker.js';
import type { JobRunner, RunnerOptions } from '../src/runner/types.js';
import type { Job, RunnerResult } from '../types/job.js';

class MockJobRunner implements JobRunner {
  public executedJobIds: number[] = [];
  public completedJobIds: number[] = [];
  public failWithLimitOnJobId: number | null = null;
  public delayMs = 10;
  public wasAborted = false;
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async run(job: Job, options?: RunnerOptions): Promise<RunnerResult> {
    this.executedJobIds.push(job.id);
    await new Promise((r) => setTimeout(r, this.delayMs));

    if (this.failWithLimitOnJobId === job.id) {
      const resetTime = new Date(Date.now() + 60000).toISOString();
      updateJobStatus(
        job.id,
        'waiting_limit',
        {
          next_attempt_at: resetTime,
          failure_kind: 'usage_limit',
          last_error: 'Usage limit reached',
        },
        this.db
      );
      options?.onClassifiedError?.('usage_limit', 'Limit hit', resetTime);
      this.completedJobIds.push(job.id);
      return {
        jobId: job.id,
        threadId: null,
        exitCode: 1,
        logPath: '/tmp/mock.jsonl',
        errorMessage: 'Usage limit reached',
        failureKind: 'usage_limit',
        durationMs: 10,
      };
    }

    updateJobStatus(job.id, 'completed', { exit_code: 0, completed_at: new Date().toISOString() }, this.db);
    this.completedJobIds.push(job.id);
    return {
      jobId: job.id,
      threadId: 'th_mock_123',
      exitCode: 0,
      logPath: '/tmp/mock.jsonl',
      errorMessage: null,
      durationMs: 10,
    };
  }

  abort(): void {
    this.wasAborted = true;
  }
}

describe('QueueWorker', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
    db.close();
  });

  it('processes queued jobs sequentially by priority', async () => {
    createJob({ prompt: 'Job Low', priority: 'low' }, db);
    createJob({ prompt: 'Job High', priority: 'high' }, db);
    createJob({ prompt: 'Job Normal', priority: 'normal' }, db);

    const runner = new MockJobRunner(db);
    const logs: string[] = [];

    const worker = new QueueWorker(db, {
      pollIntervalMs: 10,
      runner,
      onLog: (msg) => logs.push(msg),
    });

    const runPromise = worker.start();

    // Wait until all 3 jobs are completely finished
    while (runner.completedJobIds.length < 3) {
      await new Promise((r) => setTimeout(r, 15));
    }

    await worker.stop();
    await runPromise;

    // High (#2) -> Normal (#3) -> Low (#1)
    expect(runner.executedJobIds).toEqual([2, 3, 1]);

    expect(getJobById(2, db)?.status).toBe('completed');
    expect(getJobById(3, db)?.status).toBe('completed');
    expect(getJobById(1, db)?.status).toBe('completed');
  });

  it('handles usage-limit error and waits without continuously spinning', async () => {
    const job = createJob({ prompt: 'Task needing limit wait' }, db);
    const runner = new MockJobRunner(db);
    runner.failWithLimitOnJobId = job.id;

    const logs: string[] = [];
    const worker = new QueueWorker(db, {
      pollIntervalMs: 10,
      runner,
      onLog: (msg) => logs.push(msg),
    });

    const runPromise = worker.start();

    // Wait for completion
    while (runner.completedJobIds.length < 1) {
      await new Promise((r) => setTimeout(r, 15));
    }

    await new Promise((r) => setTimeout(r, 30));
    await worker.stop();
    await runPromise;

    // Should only have attempted once and not repeatedly re-executed
    expect(runner.executedJobIds).toHaveLength(1);
    const updated = getJobById(job.id, db);
    expect(updated?.status).toBe('waiting_limit');
    expect(logs.some((l) => l.includes('usage limit'))).toBe(true);
  });

  it('aborts active runner on stop()', async () => {
    createJob({ prompt: 'Slow task' }, db);
    const runner = new MockJobRunner(db);
    runner.delayMs = 300;

    const worker = new QueueWorker(db, {
      pollIntervalMs: 10,
      runner,
    });

    const runPromise = worker.start();
    await new Promise((r) => setTimeout(r, 30));

    await worker.stop();
    await runPromise;

    expect(runner.wasAborted).toBe(true);
  });
});
