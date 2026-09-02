export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  codex_home TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting_limit', 'interrupted', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
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

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_priority_created ON jobs(priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_runnable ON jobs(status, next_attempt_at);
`;
