import pc from 'picocolors';
import type Database from 'better-sqlite3';
import { getJobById } from '../../db/jobs.js';
import type { JobStatus } from '../../types/job.js';

function formatStatus(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return pc.yellow('pending');
    case 'running':
      return pc.blue('running');
    case 'waiting_limit':
      return pc.magenta('waiting_limit');
    case 'interrupted':
      return pc.cyan('interrupted');
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
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export async function showCommand(
  idArg: string,
  optionsOrDb?: Database.Database | Record<string, unknown>
): Promise<void> {
  const jobId = parseInt(idArg, 10);
  if (isNaN(jobId)) {
    console.error(pc.red(`Error: Invalid job ID "${idArg}". Must be a number.`));
    process.exitCode = 2;
    return;
  }

  const db =
    optionsOrDb && typeof (optionsOrDb as any).prepare === 'function'
      ? (optionsOrDb as Database.Database)
      : undefined;

  const job = getJobById(jobId, db);
  if (!job) {
    console.error(pc.red(`Error: Job #${jobId} not found.`));
    process.exitCode = 1;
    return;
  }

  console.log(pc.bold(pc.cyan(`Job #${job.id}\n`)));

  console.log(`${pc.bold('Status:'.padEnd(15))} ${formatStatus(job.status)}`);
  console.log(`${pc.bold('Priority:'.padEnd(15))} ${formatPriority(job.priority)}`);
  console.log(`${pc.bold('Attempts:'.padEnd(15))} ${job.attempts || 0}`);
  console.log(`${pc.bold('Repo:'.padEnd(15))} ${job.repo_path}`);
  console.log(`${pc.bold('Codex home:'.padEnd(15))} ${job.codex_home || 'default (inherited)'}`);
  console.log(`${pc.bold('Created:'.padEnd(15))} ${formatDate(job.created_at)}`);
  console.log(`${pc.bold('Started:'.padEnd(15))} ${formatDate(job.started_at)}`);
  console.log(`${pc.bold('Completed:'.padEnd(15))} ${formatDate(job.completed_at)}`);

  if (job.next_attempt_at) {
    console.log(`${pc.bold('Next attempt:'.padEnd(15))} ${pc.magenta(formatDate(job.next_attempt_at))}`);
  }

  if (job.failure_kind) {
    console.log(`${pc.bold('Failure kind:'.padEnd(15))} ${pc.yellow(job.failure_kind)}`);
  }

  if (job.last_error) {
    console.log(`${pc.bold('Last error:'.padEnd(15))} ${pc.red(job.last_error)}`);
  }

  if (job.thread_id) {
    console.log(`${pc.bold('Session ID:'.padEnd(15))} ${job.thread_id}`);
  }

  if (job.log_path) {
    console.log(`${pc.bold('Log file:'.padEnd(15))} ${job.log_path}`);
  }

  if (job.image_paths.length > 0) {
    console.log(`${pc.bold('Images:'.padEnd(15))} ${job.image_paths.length}`);
    for (const imagePath of job.image_paths) {
      console.log(`  ${imagePath}`);
    }
  }

  console.log(`\n${pc.bold('Prompt:')}`);
  console.log(pc.gray('─'.repeat(60)));
  console.log(job.prompt);
  console.log(pc.gray('─'.repeat(60)));
}
