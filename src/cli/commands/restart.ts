import pc from 'picocolors';
import { DaemonManager } from '../../daemon/manager.js';
import { ExitCodes } from '../exit-codes.js';

export async function restartCommand(): Promise<void> {
  const manager = new DaemonManager();

  try {
    const status = await manager.getStatus();
    if (status.isRunning) {
      console.log('Stopping codex-queue...');
      await manager.stop();
    }

    console.log('Starting codex-queue...');
    const state = await manager.start();
    console.log(pc.green('✔ codex-queue restarted'));
    console.log(`  ${pc.bold('PID:')} ${state.pid}`);
    console.log(`  ${pc.bold('Log:')} ${state.logPath}`);
  } catch (err) {
    console.error(pc.red(`Failed to restart codex-queue: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = ExitCodes.ERROR;
  }
}
