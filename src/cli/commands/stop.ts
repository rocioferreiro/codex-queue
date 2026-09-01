import pc from 'picocolors';
import { DaemonManager } from '../../daemon/manager.js';
import { ExitCodes } from '../exit-codes.js';

export async function stopCommand(): Promise<void> {
  const manager = new DaemonManager();

  try {
    const status = await manager.getStatus();
    if (!status.isRunning) {
      if (status.isStale) {
        console.log(pc.yellow('codex-queue was stopped (stale PID file cleaned up).'));
      } else {
        console.log(pc.yellow('codex-queue is not running.'));
      }
      process.exitCode = ExitCodes.DAEMON_NOT_RUNNING;
      return;
    }

    console.log('Stopping codex-queue...');
    const result = await manager.stop();

    if (result.stopped) {
      console.log(pc.green('✔ codex-queue stopped gracefully'));
    } else {
      console.error(pc.red('✖ Failed to stop codex-queue gracefully within timeout.'));
      process.exitCode = ExitCodes.ERROR;
    }
  } catch (err) {
    console.error(pc.red(`Error stopping codex-queue: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = ExitCodes.ERROR;
  }
}
