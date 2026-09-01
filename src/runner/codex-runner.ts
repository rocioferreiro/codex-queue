import { spawn as defaultSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';
import { getJobById, updateJobStatus, updateJobThreadId } from '../db/jobs.js';
import { getJobLogPath } from '../storage/paths.js';
import { createJobLogStream } from '../storage/logs.js';
import { JsonlParser } from '../parser/jsonl.js';
import { extractThreadId } from '../parser/events.js';
import { classifyError } from '../classifier/index.js';
import { decideRetryAction } from '../policy/index.js';
import type { RunnerOptions, JobRunner } from './types.js';
import type { Job, RunnerResult, FailureKind, ResetSource } from '../types/job.js';

export class CodexRunner implements JobRunner {
  private db: Database.Database;
  private activeChild: ChildProcess | null = null;
  private isAborted = false;
  private abortReason: string | null = null;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Abort currently running child process if any
   */
  public abort(reason: string = 'Execution interrupted because worker received SIGINT'): void {
    this.isAborted = true;
    this.abortReason = reason;
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill('SIGTERM');
    }
  }

  /**
   * Run a job by ID
   */
  public async runJobById(jobId: number, options: RunnerOptions = {}): Promise<RunnerResult> {
    const job = getJobById(jobId, this.db);
    if (!job) {
      throw new Error(`Job #${jobId} not found`);
    }
    return this.run(job, options);
  }

  /**
   * Execute a Job with Codex CLI
   */
  public async run(job: Job, options: RunnerOptions = {}): Promise<RunnerResult> {
    const startTime = Date.now();
    const spawnFn = options.spawnFn || defaultSpawn;
    const codexBin = options.codexBin || process.env.CQ_CODEX_BIN || 'codex';
    const logPath = getJobLogPath(job.id);
    const startedAt = new Date().toISOString();

    this.isAborted = false;
    this.abortReason = null;

    // Determine attempts count:
    // If the job was already set to 'running' (e.g. by atomic claimNextRunnableJob),
    // we preserve job.attempts. If it was pending/waiting_limit, we increment it by 1 here.
    const alreadyIncremented = job.status === 'running' || options.skipAttemptIncrement;
    const attempts = alreadyIncremented ? job.attempts : (job.attempts || 0) + 1;

    // Ensure status is running and next_attempt_at is cleared
    updateJobStatus(
      job.id,
      'running',
      {
        started_at: startedAt,
        log_path: logPath,
        error_message: null,
        next_attempt_at: null,
        attempts,
      },
      this.db
    );

    const logStream = createJobLogStream(job.id);
    let threadId: string | null = job.thread_id;
    let stderrContent = '';
    let lastStructuredError: unknown = null;

    const args = ['exec', '--json', '--sandbox', 'workspace-write', '-C', job.repo_path, job.prompt];

    const parser = new JsonlParser({
      onEvent: (event) => {
        options.onEvent?.(event);

        if (event && typeof event === 'object') {
          const obj = event as Record<string, unknown>;
          if (obj.error || obj.type === 'error' || obj.type?.toString().includes('error')) {
            lastStructuredError = obj.error || obj;
          }
        }

        if (!threadId) {
          const detected = extractThreadId(event);
          if (detected) {
            threadId = detected;
            updateJobThreadId(job.id, detected, this.db);
            options.onThreadId?.(detected);
          }
        }
      },
      onRawLine: (line) => {
        logStream.write(`${line}\n`);
        options.onLogLine?.(line);
      },
      onError: (_err, line) => {
        logStream.write(`${line}\n`);
      },
    });

    return new Promise<RunnerResult>((resolve, reject) => {
      let childProc: ChildProcess;

      try {
        childProc = spawnFn(codexBin, args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...options.env,
          },
        });
        this.activeChild = childProc;
      } catch (err) {
        this.activeChild = null;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const completedAt = new Date().toISOString();

        if (this.isAborted) {
          updateJobStatus(
            job.id,
            'interrupted',
            {
              completed_at: completedAt,
              exit_code: -1,
              error_message: this.abortReason || errorMsg,
              last_error: this.abortReason || errorMsg,
              next_attempt_at: null,
            },
            this.db
          );
          logStream.end();
          return resolve({
            jobId: job.id,
            threadId,
            exitCode: -1,
            logPath,
            errorMessage: this.abortReason || errorMsg,
            status: 'aborted',
            durationMs: Date.now() - startTime,
          });
        }

        const classification = classifyError(errorMsg, options.referenceDate);
        const retryDecision = decideRetryAction(classification, attempts, options.referenceDate);

        updateJobStatus(
          job.id,
          retryDecision.nextStatus,
          {
            completed_at: retryDecision.shouldRetry ? null : completedAt,
            exit_code: -1,
            error_message: errorMsg,
            last_error: errorMsg,
            failure_kind: classification.kind,
            next_attempt_at: retryDecision.nextAttemptAt,
          },
          this.db
        );
        logStream.end();
        return reject(err);
      }

      childProc.stdout?.on('data', (chunk: Buffer | string) => {
        parser.feed(chunk);
      });

      childProc.stderr?.on('data', (chunk: Buffer | string) => {
        const str = chunk.toString('utf8');
        stderrContent += str;
        options.onStderr?.(str);
      });

      childProc.on('error', (err: Error) => {
        this.activeChild = null;
        const completedAt = new Date().toISOString();

        if (this.isAborted) {
          updateJobStatus(
            job.id,
            'interrupted',
            {
              completed_at: completedAt,
              exit_code: -1,
              error_message: this.abortReason || err.message,
              last_error: this.abortReason || err.message,
              next_attempt_at: null,
            },
            this.db
          );
          parser.flush();
          logStream.end();
          return resolve({
            jobId: job.id,
            threadId,
            exitCode: -1,
            logPath,
            errorMessage: this.abortReason || err.message,
            status: 'aborted',
            durationMs: Date.now() - startTime,
          });
        }

        const classification = classifyError(err.message, options.referenceDate);
        const retryDecision = decideRetryAction(classification, attempts, options.referenceDate);

        updateJobStatus(
          job.id,
          retryDecision.nextStatus,
          {
            completed_at: retryDecision.shouldRetry ? null : completedAt,
            exit_code: -1,
            error_message: err.message,
            last_error: err.message,
            failure_kind: classification.kind,
            next_attempt_at: retryDecision.nextAttemptAt,
          },
          this.db
        );
        parser.flush();
        logStream.end();

        options.onClassifiedError?.(
          classification.kind,
          err.message,
          retryDecision.nextAttemptAt,
          retryDecision.resetSource,
          classification.resetAt ? classification.resetAt.toISOString() : null
        );

        resolve({
          jobId: job.id,
          threadId,
          exitCode: -1,
          logPath,
          errorMessage: err.message,
          failureKind: classification.kind,
          resetSource: retryDecision.resetSource,
          status: 'codex_failure',
          durationMs: Date.now() - startTime,
        });
      });

      childProc.on('close', (code: number | null) => {
        this.activeChild = null;
        parser.flush();
        logStream.end();

        const completedAt = new Date().toISOString();

        // If runner was intentionally aborted (e.g. SIGINT/SIGTERM from worker shutdown),
        // we record it as interrupted directly without passing through Codex error classification.
        if (this.isAborted) {
          const reason = this.abortReason || 'Execution interrupted because worker received SIGINT';
          updateJobStatus(
            job.id,
            'interrupted',
            {
              completed_at: completedAt,
              exit_code: code ?? -1,
              error_message: reason,
              last_error: reason,
              next_attempt_at: null,
              thread_id: threadId,
            },
            this.db
          );

          return resolve({
            jobId: job.id,
            threadId,
            exitCode: code ?? -1,
            logPath,
            errorMessage: reason,
            status: 'aborted',
            durationMs: Date.now() - startTime,
          });
        }

        const exitCode = code ?? 0;
        const isSuccess = exitCode === 0;
        const rawErrorMessage = stderrContent.trim() || (isSuccess ? null : `Process exited with code ${exitCode}`);

        let failureKind: FailureKind | null = null;
        let resetSource: ResetSource | null = null;

        if (isSuccess) {
          updateJobStatus(
            job.id,
            'completed',
            {
              completed_at: completedAt,
              exit_code: 0,
              error_message: null,
              last_error: null,
              failure_kind: null,
              next_attempt_at: null,
              thread_id: threadId,
            },
            this.db
          );
        } else {
          const errorSource = lastStructuredError || rawErrorMessage || `Process exited with code ${exitCode}`;
          const classification = classifyError(errorSource, options.referenceDate);
          failureKind = classification.kind;
          const retryDecision = decideRetryAction(classification, attempts, options.referenceDate);
          resetSource = retryDecision.resetSource || null;

          updateJobStatus(
            job.id,
            retryDecision.nextStatus,
            {
              completed_at: retryDecision.shouldRetry ? null : completedAt,
              exit_code: exitCode,
              error_message: rawErrorMessage,
              last_error: rawErrorMessage,
              failure_kind: classification.kind,
              next_attempt_at: retryDecision.nextAttemptAt,
              thread_id: threadId,
            },
            this.db
          );

          options.onClassifiedError?.(
            classification.kind,
            classification.message,
            retryDecision.nextAttemptAt,
            retryDecision.resetSource,
            classification.resetAt ? classification.resetAt.toISOString() : null
          );
        }

        resolve({
          jobId: job.id,
          threadId,
          exitCode,
          logPath,
          errorMessage: rawErrorMessage,
          failureKind,
          resetSource,
          status: isSuccess ? 'completed' : 'codex_failure',
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
