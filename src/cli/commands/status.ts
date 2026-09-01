import pc from 'picocolors';
import { DaemonManager } from '../../daemon/manager.js';
import { listJobs, getJobById } from '../../db/jobs.js';
import { getBaseDir } from '../../storage/paths.js';

function formatDate(isoString: string | null): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export async function statusCommand(): Promise<void> {
  const manager = new DaemonManager();

  try {
    const daemonStatus = await manager.getStatus();

    // Query job metrics from database
    const allJobs = listJobs();
    const runningJobs = allJobs.filter((j) => j.status === 'running');
    const pendingJobs = allJobs.filter((j) => j.status === 'pending');
    const waitingJobs = allJobs.filter((j) => j.status === 'waiting_limit');
    const interruptedJobs = allJobs.filter((j) => j.status === 'interrupted');
    const failedJobs = allJobs.filter((j) => j.status === 'failed');

    // Find nearest upcoming attempt for waiting jobs
    let nextUpcomingAttempt: string | null = null;
    if (waitingJobs.length > 0) {
      const sorted = [...waitingJobs].sort((a, b) => {
        if (!a.next_attempt_at) return 1;
        if (!b.next_attempt_at) return -1;
        return new Date(a.next_attempt_at).getTime() - new Date(b.next_attempt_at).getTime();
      });
      nextUpcomingAttempt = sorted[0].next_attempt_at;
    }

    if (daemonStatus.isRunning && daemonStatus.state) {
      console.log(pc.bold(pc.green('codex-queue is running\n')));
      console.log(`${pc.bold('PID:'.padEnd(22))} ${daemonStatus.state.pid}`);
      console.log(`${pc.bold('Started:'.padEnd(22))} ${formatDate(daemonStatus.state.startedAt)}`);
      console.log(`${pc.bold('Log:'.padEnd(22))} ${daemonStatus.state.logPath}`);
    } else {
      if (daemonStatus.isStale) {
        console.log(pc.bold(pc.yellow('codex-queue is stopped (stale runtime state cleaned up)\n')));
      } else {
        console.log(pc.bold(pc.gray('codex-queue is stopped\n')));
      }
    }

    const currentJobStr = runningJobs.length > 0 ? `#${runningJobs[0].id}` : 'none';
    console.log(`${pc.bold('Current job:'.padEnd(22))} ${currentJobStr}`);
    console.log(`${pc.bold('Pending:'.padEnd(22))} ${pendingJobs.length}`);
    console.log(`${pc.bold('Waiting for capacity:'.padEnd(22))} ${waitingJobs.length}`);
    console.log(`${pc.bold('Interrupted:'.padEnd(22))} ${interruptedJobs.length}`);
    console.log(`${pc.bold('Failed:'.padEnd(22))} ${failedJobs.length}`);

    if (nextUpcomingAttempt) {
      console.log(`${pc.bold('Next attempt:'.padEnd(22))} ${pc.magenta(formatDate(nextUpcomingAttempt))}`);
    }

    console.log(`${pc.bold('CQ_HOME:'.padEnd(22))} ${getBaseDir()}`);
  } catch (err) {
    console.error(pc.red(`Failed to get status: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
