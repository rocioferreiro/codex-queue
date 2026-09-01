import fs from 'node:fs';
import pc from 'picocolors';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';
import { claimNextRunnableJob, recoverRunningJobs } from '../db/jobs.js';
import { JobExecutor } from '../execution/job-executor.js';
import { getWorkerLogPath, ensureStorageDirs } from '../storage/paths.js';
import { DaemonManager } from '../daemon/manager.js';
import type { WorkerOptions, WorkerStatus } from './types.js';

function formatTime(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDate(isoString: string): string {
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

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

export class QueueWorker {
  private db: Database.Database;
  private pollIntervalMs: number;
  private executor: JobExecutor;
  private onLog: (message: string) => void;
  private verbose: boolean;
  private runnerOptions: WorkerOptions['runnerOptions'];
  private logFilePath: string;

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
    this.executor = new JobExecutor(this.db, options.runner);
    this.onLog = options.onLog || ((msg) => console.log(msg));
    this.verbose = options.verbose ?? false;
    this.runnerOptions = options.runnerOptions;
    this.logFilePath = getWorkerLogPath();
  }

  public getStatus(): WorkerStatus {
    return {
      isRunning: this.isRunning,
      activeJobId: this.activeJobId,
      processedCount: this.processedCount,
    };
  }

  /**
   * Start the worker loop
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stopRequested = false;

    // Check if background daemon is already running when running in foreground
    if (process.env.CQ_DAEMON !== '1') {
      const daemonManager = new DaemonManager();
      const daemonStatus = await daemonManager.getStatus();
      if (daemonStatus.isRunning && daemonStatus.state) {
        this.log(
          pc.yellow(
            `Warning: background codex-queue worker is already running (PID ${daemonStatus.state.pid}). Starting another foreground worker is not recommended.`
          )
        );
      }
    }

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
      this.executor.abort(`Execution interrupted because worker received ${signal}`);

      if (this.activeExecutionPromise) {
        await this.activeExecutionPromise;
      }
    }

    this.log('codex-queue worker stopped gracefully');
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
      const { job: finalJob, runnerResult } = await this.executor.executeJob(job.id, {
        ...this.runnerOptions,
        skipAttemptIncrement: true,
      });

      this.processedCount++;

      if (finalJob.status === 'completed') {
        this.log(`[${formatTime()}] ${pc.green(`job #${job.id} completed`)}`);
      } else if (finalJob.status === 'waiting_limit') {
        this.log(`[${formatTime()}] ${pc.yellow('Codex usage limit reached')}`);

        if (this.verbose) {
          if (runnerResult.errorSourceDescription) {
            this.log(`[${formatTime()}]   ${pc.gray('Failure source:')} ${runnerResult.errorSourceDescription}`);
          }
          this.log(`[${formatTime()}]   ${pc.gray('Failure kind:')} usage_limit`);

          if (runnerResult.rawExtractedClock) {
            this.log(`[${formatTime()}]   ${pc.gray('Reset extraction:')} clock time ${runnerResult.rawExtractedClock}`);
          } else if (runnerResult.resetSource === 'structured') {
            this.log(`[${formatTime()}]   ${pc.gray('Reset extraction:')} structured error payload`);
          } else if (runnerResult.resetSource === 'parsed_absolute') {
            this.log(`[${formatTime()}]   ${pc.gray('Reset extraction:')} absolute date`);
          } else if (runnerResult.resetSource === 'parsed_relative') {
            this.log(`[${formatTime()}]   ${pc.gray('Reset extraction:')} relative duration`);
          } else {
            this.log(`[${formatTime()}]   ${pc.gray('Reset extraction:')} failed`);
          }

          this.log(`[${formatTime()}]   ${pc.gray('Reset source:')} ${runnerResult.resetSource || 'fallback_backoff'}`);

          if (finalJob.next_attempt_at) {
            const resetBeforeBuffer = new Date(new Date(finalJob.next_attempt_at).getTime() - 60000);
            if (runnerResult.resetSource !== 'fallback_backoff') {
              this.log(`[${formatTime()}]   ${pc.gray('Resolved local reset:')} ${formatDate(resetBeforeBuffer.toISOString())}`);
              this.log(`[${formatTime()}]   ${pc.gray('Safety buffer:')} +60s`);
            }
            this.log(`[${formatTime()}]   ${pc.gray('Next attempt:')} ${formatDate(finalJob.next_attempt_at)}`);
          }
        }

        if (finalJob.next_attempt_at) {
          this.log(`[${formatTime()}] job #${job.id} waiting until ${formatTime(new Date(finalJob.next_attempt_at))}`);
        } else {
          this.log(`[${formatTime()}] job #${job.id} waiting for backoff retry`);
        }
      } else if (finalJob.status === 'interrupted') {
        this.log(`[${formatTime()}] ${pc.yellow(`job #${job.id} interrupted`)}`);
      } else if (finalJob.status === 'failed') {
        this.log(`[${formatTime()}] ${pc.red(`job #${job.id} failed: ${runnerResult.errorMessage || finalJob.last_error || 'unknown error'}`)}`);
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
    // 1. Output to configured callback / console
    this.onLog(message);

    // 2. Append clean stripped line to worker.log file
    try {
      ensureStorageDirs();
      const plain = stripAnsi(message);
      fs.appendFileSync(this.logFilePath, `${plain}\n`, 'utf8');
    } catch {
      // Ignore file append errors if filesystem is read-only
    }
  }
}
