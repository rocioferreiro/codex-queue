import fs from 'node:fs';
import pc from 'picocolors';
import { getJobById } from '../../db/jobs.js';
import { readJobLog } from '../../storage/logs.js';
import { extractCodexMessage } from '../../parser/events.js';
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
  onMessage?: (message: string) => void;
  readLog?: (job: Job) => string;
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
  const showMessage = dependencies.onMessage || ((message) => console.log(pc.cyan(`Codex: ${message}`)));
  const readLog = dependencies.readLog || ((job: Job) => {
    if (job.log_path && fs.existsSync(job.log_path)) return fs.readFileSync(job.log_path, 'utf8');
    return readJobLog(job.id);
  });
  const startedAt = now();
  let lastStatus: JobStatus | null = null;
  let logCursor = 0;

  while (true) {
    const job = getJob(jobId);
    if (!job) throw new Error(`Job #${jobId} not found.`);

    if (job.status !== lastStatus) {
      log(`Job #${jobId}: ${job.status}`);
      lastStatus = job.status;
    }

    const logLines = readLog(job).split(/\r?\n/).filter((line) => line.length > 0);
    while (logCursor < logLines.length) {
      try {
        const message = extractCodexMessage(JSON.parse(logLines[logCursor]) as Record<string, unknown>);
        if (message) showMessage(message);
      } catch {
        // Ignore incomplete or non-JSON log lines while the runner is active.
      }
      logCursor++;
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
