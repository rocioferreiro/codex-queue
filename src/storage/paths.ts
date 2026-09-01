import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function getBaseDir(): string {
  return process.env.CQ_HOME || path.join(os.homedir(), '.codex-queue');
}

export function getDbPath(): string {
  return process.env.CQ_DB_PATH || path.join(getBaseDir(), 'codex-queue.db');
}

export function getLogsDir(): string {
  return process.env.CQ_LOGS_DIR || path.join(getBaseDir(), 'logs');
}

export function getJobLogPath(jobId: number | string): string {
  return path.join(getLogsDir(), `job-${jobId}.jsonl`);
}

export function getWorkerPidPath(): string {
  return path.join(getBaseDir(), 'worker.pid');
}

export function getWorkerStatePath(): string {
  return path.join(getBaseDir(), 'worker-state.json');
}

export function getWorkerLogPath(): string {
  return path.join(getBaseDir(), 'worker.log');
}

export function ensureStorageDirs(): void {
  const baseDir = getBaseDir();
  const logsDir = getLogsDir();
  const dbDir = path.dirname(getDbPath());

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }
}
