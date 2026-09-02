import pc from 'picocolors';
import { getJobById } from '../../db/jobs.js';
import type { Job, JobStatus } from '../../types/job.js';

const terminalStatuses = new Set<JobStatus>(['completed', 'failed', 'cancelled', 'interrupted']);

export interface WaitOptions {
  interval?: string;
  timeout?: string;
}

export interface WaitDependencies {
  getJob?: (jobId: number) => Job | null;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  onLog?: (message: string) => void;
}

function parsePositiveNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

export async function waitForJob(
  jobId: number,
  options: WaitOptions = {},
  dependencies: WaitDependencies = {}
): Promise<Job> {
  const interval = parsePositiveNumber(options.interval, '--interval') ?? 1000;
  const timeout = parsePositiveNumber(options.timeout, '--timeout');
  const getJob = dependencies.getJob || getJobById;
  const sleep = dependencies.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now || (() => Date.now());
  const log = dependencies.onLog || ((message) => console.log(message));
  const startedAt = now();
  let lastStatus: JobStatus | null = null;

  while (true) {
    const job = getJob(jobId);
    if (!job) throw new Error(`Job #${jobId} not found.`);

    if (job.status !== lastStatus) {
      log(`Job #${jobId}: ${job.status}`);
      lastStatus = job.status;
    }

    if (terminalStatuses.has(job.status)) return job;

    if (timeout !== undefined && now() - startedAt >= timeout) {
      throw new Error(`Timed out waiting for job #${jobId}.`);
    }

    await sleep(interval);
  }
}

export async function waitCommand(idArg: string, options: WaitOptions): Promise<void> {
  const jobId = Number(idArg);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    console.error(pc.red(`Error: Invalid job ID "${idArg}". Must be a positive number.`));
    process.exitCode = 1;
    return;
  }

  try {
    const job = await waitForJob(jobId, options);
    if (job.status === 'completed') {
      console.log(pc.green(`✔ Job #${jobId} completed successfully.`));
      process.exitCode = 0;
    } else {
      console.error(pc.red(`✖ Job #${jobId} finished with status: ${job.status}.`));
      if (job.last_error || job.error_message) console.error(pc.red(`  ${job.last_error || job.error_message}`));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
