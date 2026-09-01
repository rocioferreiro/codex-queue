import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Checks if a process with the given PID is currently alive.
 */
export function isProcessAlive(pid: number): boolean {
  if (pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    // EPERM means process exists but we lack permission to send signals (it is alive)
    // ESRCH means process does not exist
    return error.code === 'EPERM';
  }
}

/**
 * Verifies that the process owning `pid` is actually a codex-queue worker,
 * protecting against PID reuse by unrelated processes.
 */
export async function verifyProcessIdentity(
  pid: number,
  customExec?: typeof execFileAsync
): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return false;
  }

  const runner = customExec || execFileAsync;

  try {
    // ps -p <pid> -o command= returns the command line on macOS / Linux
    const { stdout } = await runner('ps', ['-p', String(pid), '-o', 'command=']);
    const cmd = stdout.trim().toLowerCase();

    // Check if the command line references codex-queue, cq, or worker
    const isMatched =
      cmd.includes('codex-queue') ||
      cmd.includes('cq') ||
      cmd.includes('bin/cq') ||
      cmd.includes('worker');

    return isMatched;
  } catch {
    // If ps fails (e.g. process exited between check, or permission denied), treat as unverified
    return false;
  }
}

/**
 * Sends a signal to the process if it exists.
 */
export function sendSignal(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}
