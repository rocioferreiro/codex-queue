import type Database from 'better-sqlite3';
import { getDatabase } from './client.js';
import type { Job, CreateJobInput, JobFilter, JobStatus } from '../types/job.js';

export function createJob(input: CreateJobInput, db: Database.Database = getDatabase()): Job {
  const now = new Date().toISOString();
  const repoPath = input.repo_path || process.cwd();

  const stmt = db.prepare(`
    INSERT INTO jobs (prompt, repo_path, status, created_at)
    VALUES (?, ?, 'pending', ?)
  `);

  const result = stmt.run(input.prompt, repoPath, now);
  const id = Number(result.lastInsertRowid);

  return {
    id,
    prompt: input.prompt,
    repo_path: repoPath,
    status: 'pending',
    thread_id: null,
    log_path: null,
    exit_code: null,
    error_message: null,
    created_at: now,
    started_at: null,
    completed_at: null,
  };
}

export function getJobById(id: number, db: Database.Database = getDatabase()): Job | null {
  const stmt = db.prepare(`
    SELECT id, prompt, repo_path, status, thread_id, log_path, exit_code, error_message, created_at, started_at, completed_at
    FROM jobs
    WHERE id = ?
  `);

  const row = stmt.get(id) as Job | undefined;
  return row ?? null;
}

export function listJobs(filter: JobFilter = {}, db: Database.Database = getDatabase()): Job[] {
  let query = `
    SELECT id, prompt, repo_path, status, thread_id, log_path, exit_code, error_message, created_at, started_at, completed_at
    FROM jobs
  `;
  const params: unknown[] = [];

  if (filter.status) {
    query += ' WHERE status = ?';
    params.push(filter.status);
  }

  query += ' ORDER BY id ASC';

  if (filter.limit) {
    query += ' LIMIT ?';
    params.push(filter.limit);
    if (filter.offset) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }
  }

  const stmt = db.prepare(query);
  return stmt.all(...params) as Job[];
}

export function updateJobStatus(
  id: number,
  status: JobStatus,
  updates: Partial<Pick<Job, 'started_at' | 'completed_at' | 'thread_id' | 'exit_code' | 'error_message' | 'log_path'>> = {},
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
