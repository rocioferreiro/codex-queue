import pc from 'picocolors';
import { listJobs } from '../../db/jobs.js';
import type { Job, JobStatus } from '../../types/job.js';

function formatStatus(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return pc.yellow('pending');
    case 'running':
      return pc.blue('running');
    case 'completed':
      return pc.green('completed');
    case 'failed':
      return pc.red('failed');
    default:
      return status;
  }
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  const singleLine = str.replace(/\r?\n|\r/g, ' ');
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + '...';
}

function formatDate(isoString: string): string {
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
          'STATUS'.padEnd(12),
          'THREAD ID'.padEnd(16),
          'CREATED'.padEnd(18),
          'PROMPT',
        ].join('  ')
      )
    );
    console.log(pc.gray('─'.repeat(80)));

    for (const job of jobs) {
      const idStr = `#${job.id}`.padEnd(5);
      const statusRaw = job.status.padEnd(12);
      const statusColored = formatStatus(job.status) + ' '.repeat(Math.max(0, 12 - job.status.length));
      const threadStr = (job.thread_id || '-').padEnd(16);
      const createdStr = formatDate(job.created_at).padEnd(18);
      const promptStr = truncate(job.prompt, 40);

      console.log(`${idStr}  ${statusColored}  ${threadStr}  ${createdStr}  ${promptStr}`);
    }

    console.log(pc.gray(`\nTotal: ${jobs.length} job(s)`));
  } catch (err) {
    console.error(pc.red(`Failed to list jobs: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
