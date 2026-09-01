import pc from 'picocolors';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';
import { claimNextRunnableJob, recoverRunningJobs, getJobById } from '../db/jobs.js';
import { CodexRunner } from '../runner/codex-runner.js';
import type { JobRunner } from '../runner/types.js';
import type { WorkerOptions, WorkerStatus } from './types.js';

function formatTime(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export class QueueWorker {
  private db: Database.Database;
  private pollIntervalMs: number;
  private runner: JobRunner;
  private onLog: (message: string) => void;
  private verbose: boolean;
  private runnerOptions: WorkerOptions['runnerOptions'];

  private isRunning = false;
  private activeJobId: number | null = null;
  private activeExecutionPromise: Promise<void> | null = null;
  private processedCount = 0;
  private stopRequested = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private workerPromiseResolve: (() => void) | null = null;

  constructor(db?: Database.Database, options: WorkerOptions = {}) {
    this.db = db || getDatabase();
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.runner = options.runner || new CodexRunner(this.db);
    this.onLog = options.onLog || ((msg) => console.log(msg));
    this.verbose = options.verbose ?? false;
    this.runnerOptions = options.runnerOptions;
  }

  public getStatus(): WorkerStatus {
    return {
      isRunning: this.isRunning,
      activeJobId: this.activeJobId,
      processedCount: this.processedCount,
    };
  }

  /**
   * Start the worker loop in foreground
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stopRequested = false;

    // Recover any orphaned running jobs from previous session crash
    const recovered = recoverRunningJobs(this.db);
    if (recovered > 0) {
      this.log(`Recovered ${recovered} orphaned running job(s) from previous session (marked as interrupted).`);
    }

    this.log(pc.bold(pc.cyan('codex-queue worker started')));

    return new Promise<void>((resolve) => {
      this.workerPromiseResolve = resolve;
      this.scheduleNextPoll(0);
    });
  }

  /**
   * Gracefully stop the worker
   */
  public async stop(signal: string = 'SIGINT'): Promise<void> {
    if (!this.isRunning || this.stopRequested) return;
    this.stopRequested = true;

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    if (this.activeJobId !== null) {
      this.log(`Stopping worker... aborting active job #${this.activeJobId}`);
      this.runner.abort(`Execution interrupted because worker received ${signal}`);

      // Wait for the active execution to safely close and update status in database
      if (this.activeExecutionPromise) {
        await this.activeExecutionPromise;
      }
    }

    this.isRunning = false;
    this.workerPromiseResolve?.();
  }

  private scheduleNextPoll(delayMs: number = this.pollIntervalMs): void {
    if (this.stopRequested) return;

    this.pollTimeout = setTimeout(async () => {
      await this.pollAndExecute();
      if (!this.stopRequested && this.isRunning) {
        this.scheduleNextPoll();
      }
    }, delayMs);
  }

  private async pollAndExecute(): Promise<void> {
    if (this.stopRequested) return;

    const nowIso = new Date().toISOString();
    const job = claimNextRunnableJob(nowIso, this.db);

    if (!job) {
      // No runnable jobs at this moment
      return;
    }

    this.activeJobId = job.id;
    const isRetry = (job.attempts || 0) > 1;
    const actionStr = isRetry
      ? `job #${job.id} retrying (attempt ${job.attempts})`
      : `job #${job.id} starting`;
    this.log(`[${formatTime()}] ${actionStr}`);

    let executionResolve: () => void;
    this.activeExecutionPromise = new Promise((resolve) => {
      executionResolve = resolve;
    });

    try {
      const result = await this.runner.run(job, {
        ...this.runnerOptions,
        skipAttemptIncrement: true, // claimNextRunnableJob already incremented attempts
        onClassifiedError: (kind, message, nextAttemptAt, resetSource, extractedResetTime) => {
          if (kind === 'usage_limit') {
            this.log(`[${formatTime()}] ${pc.yellow('Codex usage limit reached')}`);

            if (this.verbose) {
              this.log(`[${formatTime()}]   ${pc.gray('Usage limit classified from:')} stderr message`);
              if (extractedResetTime) {
                this.log(`[${formatTime()}]   ${pc.gray('Reset time extraction:')} ${extractedResetTime} (${resetSource})`);
                this.log(`[${formatTime()}]   ${pc.gray('Safety buffer:')} +60s`);
              } else {
                this.log(`[${formatTime()}]   ${pc.gray('Reset time extraction:')} failed`);
                this.log(`[${formatTime()}]   ${pc.gray('Retry policy:')} fallback backoff`);
              }
            }

            if (nextAttemptAt) {
              const resetDate = new Date(nextAttemptAt);
              this.log(`[${formatTime()}] job #${job.id} waiting until ${formatTime(resetDate)}`);
            } else {
              this.log(`[${formatTime()}] job #${job.id} waiting for backoff retry`);
            }
          } else if (kind === 'rate_limit') {
            this.log(`[${formatTime()}] ${pc.yellow('Codex rate limit reached; waiting for backoff retry')}`);
          }
        },
      });

      this.processedCount++;

      // Inspect latest job status
      const latestJob = getJobById(job.id, this.db);
      if (latestJob?.status === 'completed') {
        this.log(`[${formatTime()}] ${pc.green(`job #${job.id} completed`)}`);
      } else if (latestJob?.status === 'interrupted') {
        this.log(`[${formatTime()}] ${pc.yellow(`job #${job.id} interrupted`)}`);
      } else if (latestJob?.status === 'failed') {
        this.log(`[${formatTime()}] ${pc.red(`job #${job.id} failed: ${result.errorMessage || 'unknown error'}`)}`);
      }
    } catch (err) {
      this.log(`[${formatTime()}] ${pc.red(`job #${job.id} execution error: ${err instanceof Error ? err.message : String(err)}`)}`);
    } finally {
      this.activeJobId = null;
      executionResolve!();
      this.activeExecutionPromise = null;
    }
  }

  private log(message: string): void {
    this.onLog(message);
  }
}
