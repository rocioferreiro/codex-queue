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

  describe('4. Usage Limit Retry Time & Fallback Backoff', () => {
    const referenceDate = new Date('2026-09-01T12:00:00.000Z');

    it('schedules parsed absolute reset time + 60s safety buffer', () => {
      const classification = classifyError(
        "You've hit your usage limit. Try again at Sep 1st, 2026 5:32 PM UTC",
        referenceDate
      );
      expect(classification.kind).toBe('usage_limit');
      expect(classification.resetAt).not.toBeNull();

      const decision = decideRetryAction(classification, 1, referenceDate);
      expect(decision.shouldRetry).toBe(true);
      expect(decision.nextStatus).toBe('waiting_limit');
      expect(decision.resetSource).toBe('parsed_absolute');

      // 17:32:00 UTC + 60s = 17:33:00 UTC
      expect(decision.nextAttemptAt).toBe(new Date(classification.resetAt!.getTime() + 60000).toISOString());
    });

    it('uses >= 10 minute fallback backoff for usage limit when no reset timestamp is found', () => {
      const classification = classifyError(
        "You've hit your usage limit. Please upgrade your plan.",
        referenceDate
      );
      expect(classification.kind).toBe('usage_limit');
      expect(classification.resetAt).toBeNull();

      // Attempt 1: 10 minutes
      const decision1 = decideRetryAction(classification, 1, referenceDate);
      expect(decision1.shouldRetry).toBe(true);
      expect(decision1.delayMs).toBe(10 * 60 * 1000); // 600,000 ms
      expect(decision1.resetSource).toBe('fallback_backoff');
      expect(new Date(decision1.nextAttemptAt!).getTime() - referenceDate.getTime()).toBe(10 * 60 * 1000);

      // Attempt 2: 20 minutes
      const decision2 = decideRetryAction(classification, 2, referenceDate);
      expect(decision2.delayMs).toBe(20 * 60 * 1000);

      // Attempt 3: 40 minutes
      const decision3 = decideRetryAction(classification, 3, referenceDate);
      expect(decision3.delayMs).toBe(40 * 60 * 1000);

      // Attempt 4: capped at 60 minutes
      const decision4 = decideRetryAction(classification, 4, referenceDate);
      expect(decision4.delayMs).toBe(60 * 60 * 1000);
    });

    it('never uses a 60 second retry interval when no reset timestamp is available', () => {
      const classification = classifyError("Usage limit exceeded", referenceDate);
      const decision = decideRetryAction(classification, 1, referenceDate);
      expect(decision.delayMs).not.toBe(60_000);
      expect(decision.delayMs).toBeGreaterThanOrEqual(10 * 60 * 1000);
    });
  });

  describe('5. Next Attempt At Cleanup on Lifecycle Transitions', () => {
    it('clears next_attempt_at when job transitions to running', () => {
      const job = createJob({ prompt: 'Waiting task' }, db);
      const future = new Date('2026-09-01T15:00:00.000Z').toISOString();
      updateJobStatus(job.id, 'waiting_limit', { next_attempt_at: future }, db);

      const claimed = claimNextRunnableJob(new Date('2026-09-01T15:01:00.000Z').toISOString(), db);
      expect(claimed?.status).toBe('running');
      expect(claimed?.next_attempt_at).toBeNull();
    });

    it('clears next_attempt_at on terminal states (completed, cancelled, interrupted)', () => {
      const j1 = createJob({ prompt: 'J1' }, db);
      updateJobStatus(j1.id, 'completed', { next_attempt_at: null }, db);
      expect(getJobById(j1.id, db)?.next_attempt_at).toBeNull();

      const j2 = createJob({ prompt: 'J2' }, db);
      cancelJob(j2.id, db);
      expect(getJobById(j2.id, db)?.next_attempt_at).toBeNull();

      const j3 = createJob({ prompt: 'J3' }, db);
      updateJobStatus(j3.id, 'interrupted', { next_attempt_at: null }, db);
      expect(getJobById(j3.id, db)?.next_attempt_at).toBeNull();
    });
  });

  describe('6. Reset Source Reporting & Classification', () => {
    it('correctly labels resetSource for structured, parsed, and fallback', () => {
      // Structured
      const structured = classifyError({ code: 'usage_limit', reset_at: '2026-09-01T16:00:00.000Z' });
      expect(structured.resetSource).toBe('structured');

      // Parsed Absolute
      const absolute = classifyError("You've hit your usage limit. Try again at Sep 1st, 2026 5:32 PM");
      expect(absolute.resetSource).toBe('parsed_absolute');

      // Parsed Relative
      const relative = classifyError("Usage limit reached. Please try again in 15 minutes");
      expect(relative.resetSource).toBe('parsed_relative');

      // Fallback
      const fallback = classifyError("Usage limit exceeded without any date");
      const decision = decideRetryAction(fallback, 1);
      expect(decision.resetSource).toBe('fallback_backoff');
    });
  });
});
