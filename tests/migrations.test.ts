import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { getJobById, createJob, updateJobStatus } from '../src/db/jobs.js';

describe('Database Migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Setup milestone 1 legacy schema
    db.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
        thread_id TEXT,
        log_path TEXT,
        exit_code INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      INSERT INTO jobs (prompt, repo_path, status, created_at)
      VALUES ('Legacy task 1', '/repo/1', 'pending', '2026-09-01T10:00:00.000Z');
      INSERT INTO jobs (prompt, repo_path, status, created_at)
      VALUES ('Legacy task 2', '/repo/2', 'completed', '2026-09-01T10:05:00.000Z');
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('safely migrates milestone 1 schema without data loss', () => {
    runMigrations(db);

    // Existing rows preserved
    const row1 = getJobById(1, db);
    expect(row1).not.toBeNull();
    expect(row1?.prompt).toBe('Legacy task 1');
    expect(row1?.status).toBe('pending');
    expect(row1?.attempts).toBe(0);
    expect(row1?.priority).toBe(0);
    expect(row1?.next_attempt_at).toBeNull();
    expect(row1?.failure_kind).toBeNull();
    expect(row1?.codex_home).toBeNull();

    const row2 = getJobById(2, db);
    expect(row2?.status).toBe('completed');

    // New statuses supported
    updateJobStatus(1, 'waiting_limit', { next_attempt_at: '2026-09-01T12:00:00.000Z' }, db);
    const updated1 = getJobById(1, db);
    expect(updated1?.status).toBe('waiting_limit');
    expect(updated1?.next_attempt_at).toBe('2026-09-01T12:00:00.000Z');

    // Creating new jobs with priority works
    const newJob = createJob({ prompt: 'New high priority', priority: 'high' }, db);
    expect(newJob.priority).toBe(10);
    expect(newJob.status).toBe('pending');

    // Cancel status supported
    updateJobStatus(newJob.id, 'cancelled', {}, db);
    const cancelledJob = getJobById(newJob.id, db);
    expect(cancelledJob?.status).toBe('cancelled');
  });

  it('is idempotent when run multiple times', () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
  });
});
