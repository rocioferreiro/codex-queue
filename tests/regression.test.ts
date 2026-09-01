import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { createJob, getJobById, updateJobStatus, claimNextRunnableJob, recoverRunningJobs, retryJob, cancelJob } from '../src/db/jobs.js';
import { CodexRunner } from '../src/runner/codex-runner.js';
import { JobExecutor } from '../src/execution/job-executor.js';
import { QueueWorker } from '../src/worker/worker.js';
import { classifyError } from '../src/classifier/index.js';
import { decideRetryAction } from '../src/policy/retry.js';

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
    setTimeout(() => {
      proc.emit('close', null, signal);
    }, 10);
  };
  return proc;
}

describe('Milestone 2 Regression Tests', () => {
  let db: Database.Database;
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-regression-test-'));
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
    } catch {}
  });

  describe('1. Attempt Counting Semantics', () => {
    it('initial job has attempts = 0', () => {
      const job = createJob({ prompt: 'Initial task' }, db);
      expect(job.attempts).toBe(0);
    });

    it('increments attempts exactly once per execution and retry', async () => {
      const job = createJob({ prompt: 'Retry task' }, db);
      const runner = new CodexRunner(db);

      // --- First Execution ---
      const now1 = new Date().toISOString();
      const claimed1 = claimNextRunnableJob(now1, db);
      expect(claimed1?.id).toBe(job.id);
      expect(claimed1?.attempts).toBe(1);

      // Simulate limit failure with explicit reset
      const mockProc1 = createMockChildProcess();
      const mockSpawn1 = () => {
        setTimeout(() => {
          mockProc1.stderr.write("You've hit your usage limit. Try again at Sep 1st, 2026 5:32 PM UTC\n");
          mockProc1.emit('close', 1);
        }, 10);
        return mockProc1 as any;
      };

      await runner.run(claimed1!, {
        spawnFn: mockSpawn1 as any,
        skipAttemptIncrement: true,
        referenceDate: new Date('2026-09-01T12:00:00.000Z'),
      });

      const afterFirstExec = getJobById(job.id, db);
      expect(afterFirstExec?.status).toBe('waiting_limit');
      expect(afterFirstExec?.attempts).toBe(1); // EXACTLY 1!
      expect(afterFirstExec?.next_attempt_at).not.toBeNull();

      // --- First Retry (past next_attempt_at) ---
      const pastFirstReset = new Date(new Date(afterFirstExec!.next_attempt_at!).getTime() + 1000).toISOString();
      const claimed2 = claimNextRunnableJob(pastFirstReset, db);
      expect(claimed2?.id).toBe(job.id);
      expect(claimed2?.attempts).toBe(2); // EXACTLY 2!

      const mockProc2 = createMockChildProcess();
      const mockSpawn2 = () => {
        setTimeout(() => {
          mockProc2.stderr.write("You've hit your usage limit. Try again at Sep 1st, 2026 6:00 PM UTC\n");
          mockProc2.emit('close', 1);
        }, 10);
        return mockProc2 as any;
      };

      await runner.run(claimed2!, {
        spawnFn: mockSpawn2 as any,
        skipAttemptIncrement: true,
        referenceDate: new Date('2026-09-01T17:35:00.000Z'),
      });

      const afterSecondExec = getJobById(job.id, db);
      expect(afterSecondExec?.status).toBe('waiting_limit');
      expect(afterSecondExec?.attempts).toBe(2); // EXACTLY 2!
      expect(afterSecondExec?.next_attempt_at).not.toBeNull();

      // --- Second Retry (past next_attempt_at) ---
      const pastSecondReset = new Date(new Date(afterSecondExec!.next_attempt_at!).getTime() + 1000).toISOString();
      const claimed3 = claimNextRunnableJob(pastSecondReset, db);
      expect(claimed3?.id).toBe(job.id);
      expect(claimed3?.attempts).toBe(3); // EXACTLY 3!
    });
  });

  describe('2. Graceful Shutdown & Interrupted State', () => {
    it('sets status to interrupted and persists clear last_error on worker abort', async () => {
      const job = createJob({ prompt: 'Abort task' }, db);
      const runner = new CodexRunner(db);
      const mockProc = createMockChildProcess();

      const runPromise = runner.run(job, {
        spawnFn: (() => mockProc) as any,
      });

      // Abort
      runner.abort('Execution interrupted because worker received SIGINT');
      const result = await runPromise;

      expect(result.status).toBe('aborted');
      expect(result.errorMessage).toContain('Execution interrupted because worker received SIGINT');

      const updated = getJobById(job.id, db);
      expect(updated?.status).toBe('interrupted');
      expect(updated?.last_error).toContain('Execution interrupted because worker received SIGINT');
      expect(updated?.next_attempt_at).toBeNull();
    });

    it('interrupted jobs are NOT automatically runnable by worker', () => {
      const job = createJob({ prompt: 'Interrupted task' }, db);
      updateJobStatus(job.id, 'interrupted', { next_attempt_at: null }, db);

      const claim = claimNextRunnableJob(new Date().toISOString(), db);
      expect(claim).toBeNull();
    });

    it('allows manual cq retry on interrupted job and preserves attempts', () => {
      const job = createJob({ prompt: 'Task to retry' }, db);
      updateJobStatus(job.id, 'interrupted', { attempts: 3, last_error: 'SIGINT' }, db);

      const retryRes = retryJob(job.id, db);
      expect(retryRes.success).toBe(true);
      expect(retryRes.job?.status).toBe('pending');
      expect(retryRes.job?.attempts).toBe(3);
      expect(retryRes.job?.last_error).toBeNull();
      expect(retryRes.job?.next_attempt_at).toBeNull();
    });

    it('allows manual cq retry on failed job and preserves attempts', () => {
      const job = createJob({ prompt: 'Failed task to retry' }, db);
      updateJobStatus(job.id, 'failed', { attempts: 2, last_error: '500 Internal' }, db);

      const retryRes = retryJob(job.id, db);
      expect(retryRes.success).toBe(true);
      expect(retryRes.job?.status).toBe('pending');
      expect(retryRes.job?.attempts).toBe(2);
    });

    it('allows cancelling interrupted jobs', () => {
      const job = createJob({ prompt: 'Task to cancel' }, db);
      updateJobStatus(job.id, 'interrupted', {}, db);

      const cancelRes = cancelJob(job.id, db);
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.job?.status).toBe('cancelled');
    });
  });

  describe('3. Crash Recovery Semantics', () => {
    it('converts orphaned running jobs to interrupted (NOT pending)', () => {
      const job = createJob({ prompt: 'Orphan running task' }, db);
      updateJobStatus(job.id, 'running', { started_at: new Date().toISOString(), attempts: 1 }, db);

      const recoveredCount = recoverRunningJobs(db);
      expect(recoveredCount).toBe(1);

      const recoveredJob = getJobById(job.id, db);
      expect(recoveredJob?.status).toBe('interrupted');
      expect(recoveredJob?.last_error).toContain('unexpected worker or process crash');
      expect(recoveredJob?.next_attempt_at).toBeNull();

      // Ensure it is not runnable without explicit manual retry
      const claim = claimNextRunnableJob(new Date().toISOString(), db);
      expect(claim).toBeNull();
    });
  });

  describe('4. Real Codex Error Message & Clock-Only Parsing', () => {
    it('parses exact real Codex turn.failed message with time-only reset', () => {
      // Local reference time: 13:45 (1:45 PM)
      const referenceDate = new Date(2026, 8, 1, 13, 45, 0);
      const realMessage = "You've hit your usage limit. Upgrade to Pro (...), visit (...) to purchase more credits or try again at 8:09 PM.";

      const classification = classifyError(
        {
          type: 'turn.failed',
          error: {
            message: realMessage,
          },
        },
        referenceDate
      );

      expect(classification.kind).toBe('usage_limit');
      expect(classification.resetSource).toBe('parsed_clock_time');
      expect(classification.rawClock).toBe('8:09 PM');
      expect(classification.errorSourceDescription).toBe('JSONL turn.failed');

      // Resolved local time: Sep 1, 2026 at 20:09:00
      expect(classification.resetAt?.getHours()).toBe(20);
      expect(classification.resetAt?.getMinutes()).toBe(9);

      const decision = decideRetryAction(classification, 1, referenceDate);
      expect(decision.shouldRetry).toBe(true);
      expect(decision.nextStatus).toBe('waiting_limit');
      expect(decision.resetSource).toBe('parsed_clock_time');

      // Next attempt must be reset time + 60s safety buffer: 20:10:00
      const nextAttempt = new Date(decision.nextAttemptAt!);
      expect(nextAttempt.getHours()).toBe(20);
      expect(nextAttempt.getMinutes()).toBe(10);
      expect(nextAttempt.getSeconds()).toBe(0);
    });

    it('shared JobExecutor persists waiting_limit for exact real Codex error fixture', async () => {
      const job = createJob({ prompt: 'Real output test task' }, db);
      const executor = new JobExecutor(db);

      const mockProc = createMockChildProcess();
      const mockSpawn = () => {
        setTimeout(() => {
          mockProc.stdout.write('{"type":"thread.started","thread_id":"01a05ddc-6cd1-7f31-be39-0d2bed3dbdee"}\n');
          mockProc.stdout.write('{"type":"turn.started"}\n');
          mockProc.stdout.write('{"type":"error","message":"You\'ve hit your usage limit. Upgrade to Pro (...), visit (...) to purchase more credits or try again at 8:09 PM."}\n');
          mockProc.stdout.write('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Upgrade to Pro (...), visit (...) to purchase more credits or try again at 8:09 PM."}}\n');
          // Also simulate stderr diagnostic which should NOT override turn.failed
          mockProc.stderr.write('Error: Reading additional input from stdin...\n');
          mockProc.emit('close', 1);
        }, 10);
        return mockProc as any;
      };

      const referenceDate = new Date(2026, 8, 1, 13, 45, 0);

      const { job: finalJob, runnerResult } = await executor.executeJob(job.id, {
        spawnFn: mockSpawn as any,
        referenceDate,
      });

      // Assertions
      expect(finalJob.status).toBe('waiting_limit');
      expect(finalJob.failure_kind).toBe('usage_limit');
      expect(finalJob.thread_id).toBe('01a05ddc-6cd1-7f31-be39-0d2bed3dbdee');
      expect(finalJob.attempts).toBe(1);
      expect(finalJob.next_attempt_at).not.toBeNull();

      expect(runnerResult.failureKind).toBe('usage_limit');
      expect(runnerResult.resetSource).toBe('parsed_clock_time');
      expect(runnerResult.errorSourceDescription).toBe('JSONL turn.failed');

      const nextAttempt = new Date(finalJob.next_attempt_at!);
      expect(nextAttempt.getHours()).toBe(20);
      expect(nextAttempt.getMinutes()).toBe(10);
    });
  });

  describe('5. Thread ID Updates to Most Recent Attempt', () => {
    it('updates job.thread_id across multiple retry executions', async () => {
      const job = createJob({ prompt: 'Multi thread task' }, db);
      const runner = new CodexRunner(db);

      // Attempt 1: thread A
      const mockProc1 = createMockChildProcess();
      const mockSpawn1 = () => {
        setTimeout(() => {
          mockProc1.stdout.write('{"type":"thread.started","thread_id":"thread_A"}\n');
          mockProc1.emit('close', 1);
        }, 10);
        return mockProc1 as any;
      };
      await runner.run(job, { spawnFn: mockSpawn1 as any });
      expect(getJobById(job.id, db)?.thread_id).toBe('thread_A');

      // Attempt 2: thread B
      const jobAttempt2 = getJobById(job.id, db)!;
      const mockProc2 = createMockChildProcess();
      const mockSpawn2 = () => {
        setTimeout(() => {
          mockProc2.stdout.write('{"type":"thread.started","thread_id":"thread_B"}\n');
          mockProc2.emit('close', 1);
        }, 10);
        return mockProc2 as any;
      };
      await runner.run(jobAttempt2, { spawnFn: mockSpawn2 as any });
      expect(getJobById(job.id, db)?.thread_id).toBe('thread_B');

      // Attempt 3: thread C
      const jobAttempt3 = getJobById(job.id, db)!;
      const mockProc3 = createMockChildProcess();
      const mockSpawn3 = () => {
        setTimeout(() => {
          mockProc3.stdout.write('{"type":"thread.started","thread_id":"thread_C"}\n');
          mockProc3.emit('close', 0);
        }, 10);
        return mockProc3 as any;
      };
      await runner.run(jobAttempt3, { spawnFn: mockSpawn3 as any });
      expect(getJobById(job.id, db)?.thread_id).toBe('thread_C');
    });
  });

  describe('6. Stdin Configuration in Spawn', () => {
    it('configures stdio with ignored stdin', async () => {
      const job = createJob({ prompt: 'Stdin test' }, db);
      const runner = new CodexRunner(db);

      let capturedOptions: any = null;
      const mockProc = createMockChildProcess();
      const mockSpawn = (_cmd: string, _args: any, options: any) => {
        capturedOptions = options;
        setTimeout(() => mockProc.emit('close', 0), 10);
        return mockProc as any;
      };

      await runner.run(job, { spawnFn: mockSpawn as any });
      expect(capturedOptions.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    });
  });
});
