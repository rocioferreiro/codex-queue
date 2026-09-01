import fs from 'node:fs';
import path from 'node:path';
import { getJobLogPath } from './paths.js';

export function createJobLogStream(jobId: number | string): fs.WriteStream {
  const logPath = getJobLogPath(jobId);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
}

export function readJobLog(jobId: number | string): string {
  const logPath = getJobLogPath(jobId);
  if (!fs.existsSync(logPath)) {
    return '';
  }
  return fs.readFileSync(logPath, 'utf8');
}

export function jobLogExists(jobId: number | string): boolean {
  const logPath = getJobLogPath(jobId);
  return fs.existsSync(logPath);
}
