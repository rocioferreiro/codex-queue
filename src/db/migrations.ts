import type Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export function runMigrations(db: Database.Database): void {
  // Check if jobs table exists
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
  ).get();

  if (!tableCheck) {
    // Brand new database, create schema directly
    db.exec(SCHEMA_SQL);
    return;
  }

  // Inspect existing columns
  const columns = db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));

  const hasNewCols =
    colNames.has('attempts') &&
    colNames.has('next_attempt_at') &&
    colNames.has('last_error') &&
    colNames.has('failure_kind') &&
    colNames.has('priority');

  // Also check if CHECK constraint allows 'waiting_limit'
  let checkAllowsNewStatuses = false;
  const sqlRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'"
  ).get() as { sql?: string } | undefined;

  if (sqlRow?.sql && sqlRow.sql.includes('waiting_limit') && hasNewCols) {
    checkAllowsNewStatuses = true;
  }

  if (hasNewCols && checkAllowsNewStatuses) {
    // Already up to date, just ensure indexes exist
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_priority_created ON jobs(priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_jobs_runnable ON jobs(status, next_attempt_at);
    `);
    return;
  }

  // Safe table migration using temp table
  const migrateTransaction = db.transaction(() => {
    db.exec(`
      CREATE TABLE jobs_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting_limit', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
        thread_id TEXT,
        log_path TEXT,
        exit_code INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        failure_kind TEXT,
        priority INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Dynamically build select statement based on existing columns
    const attemptsExpr = colNames.has('attempts') ? 'COALESCE(attempts, 0)' : '0';
    const nextAttemptExpr = colNames.has('next_attempt_at') ? 'next_attempt_at' : 'NULL';
    const lastErrorExpr = colNames.has('last_error') ? 'last_error' : 'NULL';
    const failureKindExpr = colNames.has('failure_kind') ? 'failure_kind' : 'NULL';
    const priorityExpr = colNames.has('priority') ? 'COALESCE(priority, 0)' : '0';

    db.exec(`
      INSERT INTO jobs_v2 (
        id, prompt, repo_path, status, thread_id, log_path, exit_code, error_message,
        created_at, started_at, completed_at, attempts, next_attempt_at, last_error, failure_kind, priority
      )
      SELECT
        id, prompt, repo_path, status, thread_id, log_path, exit_code, error_message,
        created_at, started_at, completed_at,
        ${attemptsExpr},
        ${nextAttemptExpr},
        ${lastErrorExpr},
        ${failureKindExpr},
        ${priorityExpr}
      FROM jobs;
    `);

    db.exec('DROP TABLE jobs;');
    db.exec('ALTER TABLE jobs_v2 RENAME TO jobs;');

    // Recreate indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_priority_created ON jobs(priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_jobs_runnable ON jobs(status, next_attempt_at);
    `);
  });

  migrateTransaction();
}
