import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ProcessCommandExecutor = (
  command: string,
  args: string[]
) => Promise<{ stdout: string | Buffer }>;

function processCommandQuery(pid: number, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'win32') {
    // PowerShell's CIM query returns the full command line, unlike tasklist,
    // which only exposes the executable name and cannot protect against PID reuse.
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$process = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($process) { $process.CommandLine }`,
      ],
    };
  }

  // macOS and Linux both provide ps with this portable command-line format.
  return {
    command: 'ps',
    args: ['-p', String(pid), '-o', 'command='],
  };
}

function isCodexQueueWorkerCommand(commandLine: string): boolean {
  const command = commandLine.trim().toLowerCase();
  const hasQueueCommand =
    command.includes('codex-queue') ||
    command.includes('bin/cq') ||
    /(?:^|[\\/\s])cq(?:\.js)?(?:$|[\\/\s])/.test(command);
  const hasWorkerCommand = /(?:^|[\\/\s])worker(?:$|[\\/\s])/.test(command);
  return hasQueueCommand && hasWorkerCommand;
}

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
  customExec?: ProcessCommandExecutor,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return false;
  }

  const runner: ProcessCommandExecutor = customExec || (execFileAsync as ProcessCommandExecutor);

  try {
    const query = processCommandQuery(pid, platform);
    const { stdout } = await runner(query.command, query.args);
    return isCodexQueueWorkerCommand(String(stdout));
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
