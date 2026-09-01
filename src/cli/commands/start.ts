import pc from 'picocolors';
import { DaemonManager, DaemonAlreadyRunningError } from '../../daemon/manager.js';
import { ExitCodes } from '../exit-codes.js';

export async function startCommand(): Promise<void> {
  const manager = new DaemonManager();

  try {
    const state = await manager.start();
    console.log(pc.green('✔ codex-queue started'));
    console.log(`  ${pc.bold('PID:')} ${state.pid}`);
    console.log(`  ${pc.bold('Log:')} ${state.logPath}`);
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      console.log(pc.yellow(`codex-queue is already running (PID ${err.pid}).`));
      process.exitCode = ExitCodes.DAEMON_ALREADY_RUNNING;
      return;
    }
    console.error(pc.red(`Failed to start codex-queue: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = ExitCodes.ERROR;
  }
}
