import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from '../src/db/client.js';
import {
  createJob,
  getJobById,
  listJobs,
  updateJobStatus,
  updateJobThreadId,
  deleteJob,
  scheduleJob,
} from '../src/db/jobs.js';

describe('Database Layer', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates a pending job with default repo_path', () => {
    const job = createJob({ prompt: 'Test task' }, db);
    expect(job.id).toBe(1);
    expect(job.prompt).toBe('Test task');
    expect(job.repo_path).toBe(process.cwd());
    expect(job.status).toBe('pending');
    expect(job.thread_id).toBeNull();
    expect(job.created_at).toBeDefined();
  });

  it('creates a pending job with custom repo_path', () => {
    const job = createJob({ prompt: 'Fix bugs', repo_path: '/custom/repo' }, db);
    expect(job.repo_path).toBe('/custom/repo');
  });

  it('creates a job with a scheduled next attempt', () => {
    const nextAttemptAt = '2026-09-07T13:00:00.000Z';
    const job = createJob({ prompt: 'Scheduled task', next_attempt_at: nextAttemptAt }, db);
    expect(job.next_attempt_at).toBe(nextAttemptAt);
    expect(getJobById(job.id, db)?.next_attempt_at).toBe(nextAttemptAt);
  });

  it('persists a custom codex home for a job', () => {
    const job = createJob({ prompt: 'Use another session', codex_home: '/sessions/work' }, db);
    expect(job.codex_home).toBe('/sessions/work');
    expect(getJobById(job.id, db)?.codex_home).toBe('/sessions/work');
  });

  it('persists an existing session id for a queued resume', () => {
    const job = createJob({ prompt: 'Continue the task', session_id: 'session-existing-123' }, db);
    expect(job.thread_id).toBe('session-existing-123');
    expect(getJobById(job.id, db)?.thread_id).toBe('session-existing-123');
  });

  it('captures CODEX_HOME when no per-job home is provided', () => {
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '~/.codex-personal';

    try {
      const job = createJob({ prompt: 'Use the personal session' }, db);
      expect(job.codex_home).toBe(path.join(os.homedir(), '.codex-personal'));
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it('fetches a job by ID', () => {
    const created = createJob({ prompt: 'Fetch me' }, db);
    const fetched = getJobById(created.id, db);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.prompt).toBe('Fetch me');
  });

  it('returns null for non-existent job ID', () => {
    const job = getJobById(999, db);
    expect(job).toBeNull();
  });

  it('lists jobs with optional status filter', () => {
    const j1 = createJob({ prompt: 'Job 1' }, db);
    const j2 = createJob({ prompt: 'Job 2' }, db);
    const j3 = createJob({ prompt: 'Job 3' }, db);

    updateJobStatus(j1.id, 'completed', { exit_code: 0 }, db);
    updateJobStatus(j2.id, 'failed', { exit_code: 1 }, db);

    const allJobs = listJobs({}, db);
    expect(allJobs).toHaveLength(3);

    const pendingJobs = listJobs({ status: 'pending' }, db);
    expect(pendingJobs).toHaveLength(1);
    expect(pendingJobs[0].id).toBe(j3.id);

    const completedJobs = listJobs({ status: 'completed' }, db);
    expect(completedJobs).toHaveLength(1);
    expect(completedJobs[0].id).toBe(j1.id);
  });

  it('updates thread_id and status lifecycle', () => {
    const job = createJob({ prompt: 'Lifecycle test' }, db);
    expect(job.status).toBe('pending');

    const startedAt = new Date().toISOString();
    updateJobStatus(job.id, 'running', { started_at: startedAt, log_path: '/tmp/job-1.jsonl' }, db);

    let updated = getJobById(job.id, db);
    expect(updated?.status).toBe('running');
    expect(updated?.started_at).toBe(startedAt);
    expect(updated?.log_path).toBe('/tmp/job-1.jsonl');

    updateJobThreadId(job.id, 'thread_abc123', db);
    updated = getJobById(job.id, db);
    expect(updated?.thread_id).toBe('thread_abc123');

    const completedAt = new Date().toISOString();
    updateJobStatus(job.id, 'completed', { completed_at: completedAt, exit_code: 0 }, db);
    updated = getJobById(job.id, db);
    expect(updated?.status).toBe('completed');
    expect(updated?.completed_at).toBe(completedAt);
    expect(updated?.exit_code).toBe(0);
  });

  it('deletes a job by ID', () => {
    const job = createJob({ prompt: 'To delete' }, db);
    expect(deleteJob(job.id, db)).toBe(true);
    expect(getJobById(job.id, db)).toBeNull();
  });

  it('reschedules a pending job', () => {
    const job = createJob({ prompt: 'Reschedule me' }, db);
    const nextAttemptAt = '2026-09-07T14:00:00.000Z';

    const result = scheduleJob(job.id, nextAttemptAt, db);

    expect(result.success).toBe(true);
    expect(result.job?.status).toBe('pending');
    expect(result.job?.next_attempt_at).toBe(nextAttemptAt);
  });

  it('does not reschedule a running job', () => {
    const job = createJob({ prompt: 'Running task' }, db);
    updateJobStatus(job.id, 'running', {}, db);

    const result = scheduleJob(job.id, '2026-09-07T14:00:00.000Z', db);

    expect(result.success).toBe(false);
    expect(result.message).toContain('currently running');
  });
});
