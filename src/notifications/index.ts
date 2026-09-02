import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { JobStatus } from '../types/job.js';

export interface NotificationOptions {
  platform?: NodeJS.Platform;
  spawnFn?: (command: string, args: string[], options: { detached: boolean; stdio: 'ignore' }) => ChildProcess;
  onError?: (error: Error) => void;
  subtitle?: string;
  soundName?: string;
  urgency?: 'low' | 'normal' | 'critical';
  icon?: string;
}

export function notificationsEnabled(): boolean {
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
    const subtitle = options.subtitle ? ` subtitle "${escapeAppleScript(options.subtitle)}"` : '';
    const sound = options.soundName ? ` sound name "${escapeAppleScript(options.soundName)}"` : '';
    args = [
      '-e',
      `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"${subtitle}${sound}`,
    ];
  } else if (platform === 'linux') {
    command = 'notify-send';
    args = ['--app-name=codex-queue', `--urgency=${options.urgency || 'normal'}`];
    if (options.icon) args.push(`--icon=${options.icon}`);
    args.push(title, options.subtitle ? `${options.subtitle}\n${message}` : message);
  } else {
    return false;
  }

  try {
    const child = spawnFn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', (error) => options.onError?.(error instanceof Error ? error : new Error(String(error))));
    child.on('close', (code) => {
      if (code !== null && code !== 0) {
        options.onError?.(new Error(`${command} exited with code ${code}`));
      }
    });
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
  const styles: Partial<Record<JobStatus, {
    emoji: string;
    label: string;
    soundName?: string;
    urgency?: 'low' | 'normal' | 'critical';
    icon?: string;
  }>> = {
    completed: { emoji: '✅', label: 'completed', soundName: 'Glass', icon: 'dialog-information' },
    failed: { emoji: '❌', label: 'failed', soundName: 'Basso', urgency: 'critical', icon: 'dialog-error' },
    interrupted: { emoji: '⚠️', label: 'interrupted', soundName: 'Ping', icon: 'dialog-warning' },
    waiting_limit: { emoji: '⏸️', label: 'waiting for Codex usage reset', soundName: 'Ping', urgency: 'low', icon: 'appointment-soon' },
    cancelled: { emoji: '🛑', label: 'cancelled', icon: 'process-stop' },
  };
  const style = styles[status] || { emoji: 'ℹ️', label: status, icon: 'dialog-information' };
  const title = `${style.emoji} Job #${jobId}`;
  return notify(title, detail || style.label, {
    ...options,
    subtitle: `codex-queue · ${style.label}`,
    soundName: options.soundName || style.soundName,
    urgency: options.urgency || style.urgency,
    icon: options.icon || style.icon,
  });
}
