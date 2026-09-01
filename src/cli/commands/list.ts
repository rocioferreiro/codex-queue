import pc from 'picocolors';
import { listJobs } from '../../db/jobs.js';
import type { JobStatus } from '../../types/job.js';

function formatStatus(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return pc.yellow('pending');
    case 'running':
      return pc.blue('running');
    case 'waiting_limit':
      return pc.magenta('waiting_limit');
    case 'completed':
      return pc.green('completed');
    case 'failed':
      return pc.red('failed');
    case 'cancelled':
      return pc.gray('cancelled');
    default:
      return status;
  }
}

function formatPriority(priority: number): string {
  if (priority > 0) return pc.magenta('high');
  if (priority < 0) return pc.gray('low');
  return 'normal';
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  const singleLine = str.replace(/\r?\n|\r/g, ' ');
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + '...';
}

function formatDate(isoString: string | null): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export async function listCommand(options: { status?: string; limit?: string }): Promise<void> {
  try {
    const statusFilter = options.status as JobStatus | undefined;
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;

    const jobs = listJobs({
      status: statusFilter,
      limit,
    });

    if (jobs.length === 0) {
      if (statusFilter) {
        console.log(pc.gray(`No jobs found with status "${statusFilter}".`));
      } else {
        console.log(pc.gray('No jobs in the queue. Add a job with: cq add "<prompt>"'));
      }
      return;
    }

    console.log(
      pc.bold(
        [
          'ID'.padEnd(5),
          'PRIORITY'.padEnd(9),
          'STATUS'.padEnd(14),
          'ATTEMPTS'.padEnd(9),
          'NEXT ATTEMPT'.padEnd(20),
          'THREAD ID'.padEnd(14),
          'PROMPT',
        ].join(' ')
      )
    );
    console.log(pc.gray('─'.repeat(95)));

    for (const job of jobs) {
      const idStr = `#${job.id}`.padEnd(5);
      const prioStr = formatPriority(job.priority) + ' '.repeat(Math.max(0, 9 - (job.priority > 0 ? 4 : job.priority < 0 ? 3 : 6)));
      const statusColored = formatStatus(job.status) + ' '.repeat(Math.max(0, 14 - job.status.length));
      const attemptsStr = String(job.attempts || 0).padEnd(9);
      const nextAttemptStr = formatDate(job.next_attempt_at).padEnd(20);
      const threadStr = (job.thread_id || '-').padEnd(14);
      const promptStr = truncate(job.prompt, 30);

      console.log(`${idStr} ${prioStr} ${statusColored} ${attemptsStr} ${nextAttemptStr} ${threadStr} ${promptStr}`);
    }

    console.log(pc.gray(`\nTotal: ${jobs.length} job(s)`));
  } catch (err) {
    console.error(pc.red(`Failed to list jobs: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
