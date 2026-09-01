import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDatabase } from '../src/db/client.js';
import { createJob, claimNextRunnableJob, recoverRunningJobs, getJobById, updateJobStatus } from '../src/db/jobs.js';

describe('Job Claiming & Priority Ordering', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('claims jobs strictly ordered by priority DESC, created_at ASC', () => {
    const jLow = createJob({ prompt: 'Low priority', priority: 'low' }, db);
    const jNormal1 = createJob({ prompt: 'Normal 1', priority: 'normal' }, db);
    const jHigh1 = createJob({ prompt: 'High 1', priority: 'high' }, db);
    const jHigh2 = createJob({ prompt: 'High 2', priority: 'high' }, db);

    const now = new Date().toISOString();

    // 1st claim should be High 1 (highest priority, oldest)
    const claim1 = claimNextRunnableJob(now, db);
    expect(claim1?.id).toBe(jHigh1.id);
    expect(claim1?.status).toBe('running');
    expect(claim1?.attempts).toBe(1);

    // 2nd claim should be High 2
    const claim2 = claimNextRunnableJob(now, db);
    expect(claim2?.id).toBe(jHigh2.id);

    // 3rd claim should be Normal 1
    const claim3 = claimNextRunnableJob(now, db);
    expect(claim3?.id).toBe(jNormal1.id);

    // 4th claim should be Low
    const claim4 = claimNextRunnableJob(now, db);
    expect(claim4?.id).toBe(jLow.id);

    // 5th claim: no more runnable jobs
    const claim5 = claimNextRunnableJob(now, db);
    expect(claim5).toBeNull();
  });

  it('respects next_attempt_at for waiting_limit jobs', () => {
    const job = createJob({ prompt: 'Limited task' }, db);
    const futureTime = new Date(Date.now() + 60000).toISOString();
    updateJobStatus(job.id, 'waiting_limit', { next_attempt_at: futureTime }, db);

    const now = new Date().toISOString();

    // Not runnable yet because next_attempt_at > now
    expect(claimNextRunnableJob(now, db)).toBeNull();

    // Once now surpasses next_attempt_at, it becomes runnable
    const afterFuture = new Date(Date.now() + 120000).toISOString();
    const claimed = claimNextRunnableJob(afterFuture, db);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
  });

  it('prevents duplicate execution between two simulated workers', () => {
    const job1 = createJob({ prompt: 'Task 1' }, db);
    const now = new Date().toISOString();

    const worker1Claim = claimNextRunnableJob(now, db);
    const worker2Claim = claimNextRunnableJob(now, db);

    expect(worker1Claim?.id).toBe(job1.id);
    expect(worker2Claim).toBeNull();
  });

  it('recovers hanging running jobs on worker crash / restart to interrupted', () => {
    const job = createJob({ prompt: 'Crashed worker job' }, db);
    updateJobStatus(job.id, 'running', { started_at: new Date().toISOString() }, db);

    expect(getJobById(job.id, db)?.status).toBe('running');

    const recoveredCount = recoverRunningJobs(db);
    expect(recoveredCount).toBe(1);

    const recoveredJob = getJobById(job.id, db);
    expect(recoveredJob?.status).toBe('interrupted');
    expect(recoveredJob?.last_error).toContain('unexpected worker or process crash');
  });
});
