import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { JobStatus } from '../types/job.js';

export interface NotificationOptions {
  platform?: NodeJS.Platform;
  spawnFn?: (command: string, args: string[], options: { detached: boolean; stdio: 'ignore' }) => ChildProcess;
}

function notificationsEnabled(): boolean {
  const value = process.env.CQ_NOTIFY?.trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'never';
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
}

/** Send a best-effort desktop notification without affecting queue execution. */
export function notify(title: string, message: string, options: NotificationOptions = {}): boolean {
  if (!notificationsEnabled()) return false;

  const platform = options.platform || process.platform;
  const spawnFn = options.spawnFn || ((command, args, spawnOptions) => spawn(command, args, spawnOptions));

  let command: string;
  let args: string[];

  if (platform === 'darwin') {
    command = 'osascript';
    args = [
      '-e',
      `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`,
    ];
  } else if (platform === 'linux') {
    command = 'notify-send';
    args = [title, message];
  } else {
    return false;
  }

  try {
    const child = spawnFn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function notifyJob(
  jobId: number,
  status: JobStatus,
  detail?: string,
  options: NotificationOptions = {}
): boolean {
  const title = `codex-queue · Job #${jobId}`;
  const labels: Partial<Record<JobStatus, string>> = {
    completed: 'completed',
    failed: 'failed',
    interrupted: 'interrupted',
    waiting_limit: 'waiting for Codex usage reset',
    cancelled: 'cancelled',
  };
  const message = detail ? `${labels[status] || status}: ${detail}` : labels[status] || status;
  return notify(title, message, options);
}
