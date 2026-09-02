import type Database from 'better-sqlite3';
import { getDatabase } from './client.js';
import type { Job, CreateJobInput, JobFilter, JobStatus } from '../types/job.js';
import { parsePriority } from '../types/job.js';
import { resolveCodexHome } from '../config/aliases.js';
import { resolveImagePaths } from '../storage/images.js';

const ALL_COLUMNS = `
  id, prompt, repo_path, codex_home, image_paths, status, thread_id, log_path, exit_code, error_message,
  created_at, started_at, completed_at, attempts, next_attempt_at, last_error, failure_kind, priority
`;

function parseImagePaths(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function mapJobRow(row: Omit<Job, 'image_paths'> & { image_paths?: unknown }): Job {
  return { ...row, image_paths: parseImagePaths(row.image_paths) } as Job;
}

export function createJob(input: CreateJobInput, db: Database.Database = getDatabase()): Job {
  const now = new Date().toISOString();
  const repoPath = input.repo_path || process.cwd();
  const codexHome = resolveCodexHome(input.codex_home);
  const sessionId = input.session_id?.trim() || null;
  const imagePaths = resolveImagePaths(input.image_paths);
  const priority = parsePriority(input.priority);

  const stmt = db.prepare(`
    INSERT INTO jobs (prompt, repo_path, codex_home, image_paths, status, thread_id, created_at, priority)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `);

  const result = stmt.run(input.prompt, repoPath, codexHome, JSON.stringify(imagePaths), sessionId, now, priority);
  const id = Number(result.lastInsertRowid);

  return {
    id,
    prompt: input.prompt,
    repo_path: repoPath,
    codex_home: codexHome,
    image_paths: imagePaths,
    status: 'pending',
    thread_id: sessionId,
    log_path: null,
    exit_code: null,
    error_message: null,
    created_at: now,
    started_at: null,
    completed_at: null,
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    failure_kind: null,
    priority,
  };
}

export function getJobById(id: number, db: Database.Database = getDatabase()): Job | null {
  const stmt = db.prepare(`
    SELECT ${ALL_COLUMNS}
    FROM jobs
    WHERE id = ?
  `);

  const row = stmt.get(id) as (Omit<Job, 'image_paths'> & { image_paths?: unknown }) | undefined;
  return row ? mapJobRow(row) : null;
}

export function listJobs(filter: JobFilter = {}, db: Database.Database = getDatabase()): Job[] {
  let query = `
    SELECT ${ALL_COLUMNS}
    FROM jobs
  `;
  const params: unknown[] = [];

  if (filter.status) {
    query += ' WHERE status = ?';
    params.push(filter.status);
  }

  query += ' ORDER BY priority DESC, created_at ASC, id ASC';

  if (filter.limit) {
    query += ' LIMIT ?';
    params.push(filter.limit);
    if (filter.offset) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }
  }

  const stmt = db.prepare(query);
  return (stmt.all(...params) as Array<Omit<Job, 'image_paths'> & { image_paths?: unknown }>).map(mapJobRow);
}

export function updateJobStatus(
  id: number,
  status: JobStatus,
  updates: Partial<Pick<Job, 'started_at' | 'completed_at' | 'thread_id' | 'exit_code' | 'error_message' | 'log_path' | 'attempts' | 'next_attempt_at' | 'last_error' | 'failure_kind' | 'priority'>> = {},
  db: Database.Database = getDatabase()
): void {
  const setClauses = ['status = ?'];
  const params: unknown[] = [status];

  if (updates.started_at !== undefined) {
    setClauses.push('started_at = ?');
    params.push(updates.started_at);
  }
  if (updates.completed_at !== undefined) {
    setClauses.push('completed_at = ?');
    params.push(updates.completed_at);
  }
  if (updates.thread_id !== undefined) {
    setClauses.push('thread_id = ?');
    params.push(updates.thread_id);
  }
  if (updates.exit_code !== undefined) {
    setClauses.push('exit_code = ?');
    params.push(updates.exit_code);
  }
  if (updates.error_message !== undefined) {
    setClauses.push('error_message = ?');
    params.push(updates.error_message);
  }
  if (updates.log_path !== undefined) {
    setClauses.push('log_path = ?');
    params.push(updates.log_path);
  }
  if (updates.attempts !== undefined) {
    setClauses.push('attempts = ?');
    params.push(updates.attempts);
  }
  if (updates.next_attempt_at !== undefined) {
    setClauses.push('next_attempt_at = ?');
    params.push(updates.next_attempt_at);
  }
  if (updates.last_error !== undefined) {
    setClauses.push('last_error = ?');
    params.push(updates.last_error);
  }
  if (updates.failure_kind !== undefined) {
    setClauses.push('failure_kind = ?');
    params.push(updates.failure_kind);
  }
  if (updates.priority !== undefined) {
    setClauses.push('priority = ?');
    params.push(updates.priority);
  }

  params.push(id);
  const query = `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = ?`;
  db.prepare(query).run(...params);
}

export function updateJobThreadId(
  id: number,
  threadId: string,
  db: Database.Database = getDatabase()
): void {
  db.prepare('UPDATE jobs SET thread_id = ? WHERE id = ?').run(threadId, id);
}

export function deleteJob(id: number, db: Database.Database = getDatabase()): boolean {
  const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Atomically claim the next runnable job for a worker.
 * Runnable conditions:
 * - status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now)
 * - status = 'waiting_limit' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now
 * Ordered by priority DESC, created_at ASC.
 *
 * Atomically increments attempts and clears next_attempt_at upon claiming.
 */
export function claimNextRunnableJob(
  nowIso: string = new Date().toISOString(),
  db: Database.Database = getDatabase()
): Job | null {
  const claimTx = db.transaction(() => {
    const findStmt = db.prepare(`
      SELECT id FROM jobs
      WHERE
        (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
        OR
        (status = 'waiting_limit' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
      ORDER BY priority DESC, created_at ASC, id ASC
      LIMIT 1
    `);

    const candidate = findStmt.get(nowIso, nowIso) as { id: number } | undefined;
    if (!candidate) {
      return null;
    }

    const updateStmt = db.prepare(`
      UPDATE jobs
      SET
        status = 'running',
        started_at = ?,
        attempts = attempts + 1,
        next_attempt_at = NULL
      WHERE id = ?
    `);

    updateStmt.run(nowIso, candidate.id);
    return getJobById(candidate.id, db);
  });

  return claimTx();
}

/**
 * Cancel a pending, waiting, or interrupted job.
 */
export function cancelJob(
  id: number,
  db: Database.Database = getDatabase()
): { success: boolean; message?: string; job?: Job } {
  const job = getJobById(id, db);
  if (!job) {
    return { success: false, message: `Job #${id} not found.` };
  }

  if (job.status === 'running') {
    return { success: false, message: `Job #${id} is currently running and cannot be cancelled directly.` };
  }

  if (job.status === 'completed') {
    return { success: false, message: `Job #${id} is already completed.` };
  }

  if (job.status === 'cancelled') {
    return { success: false, message: `Job #${id} is already cancelled.` };
  }

  updateJobStatus(
    id,
    'cancelled',
    {
      completed_at: new Date().toISOString(),
      next_attempt_at: null,
    },
    db
  );
  const updated = getJobById(id, db);
  return { success: true, job: updated! };
}

/**
 * Manually retry an interrupted or failed job by returning it to 'pending'.
 * Preserves the previous attempts count.
 */
export function retryJob(
  id: number,
  db: Database.Database = getDatabase()
): { success: boolean; message?: string; job?: Job } {
  const job = getJobById(id, db);
  if (!job) {
    return { success: false, message: `Job #${id} not found.` };
  }

  if (job.status !== 'interrupted' && job.status !== 'failed') {
    return {
      success: false,
      message: `Job #${id} has status '${job.status}'. Only 'interrupted' or 'failed' jobs can be retried with 'cq retry'.`,
    };
  }

  updateJobStatus(
    id,
    'pending',
    {
      started_at: null,
      completed_at: null,
      next_attempt_at: null,
      last_error: null,
      failure_kind: null,
      exit_code: null,
      error_message: null,
    },
    db
  );

  const updated = getJobById(id, db);
  return { success: true, job: updated! };
}

/**
 * On worker startup, recover jobs that were left in 'running' state (e.g. from an unclean crash)
 * by converting them to 'interrupted' (NOT 'pending' - requires manual 'cq retry').
 */
export function recoverRunningJobs(db: Database.Database = getDatabase()): number {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE jobs
    SET
      status = 'interrupted',
      last_error = 'Execution interrupted due to unexpected worker or process crash',
      completed_at = ?,
      next_attempt_at = NULL
    WHERE status = 'running'
  `);
  const result = stmt.run(now);
  return result.changes;
}
