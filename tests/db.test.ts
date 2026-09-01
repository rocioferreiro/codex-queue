import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDatabase } from '../src/db/client.js';
import { createJob, getJobById, listJobs, updateJobStatus, updateJobThreadId, deleteJob } from '../src/db/jobs.js';

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
});
