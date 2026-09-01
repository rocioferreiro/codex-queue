import { spawn as defaultSpawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';
import { getJobById, updateJobStatus, updateJobThreadId } from '../db/jobs.js';
import { getJobLogPath } from '../storage/paths.js';
import { createJobLogStream } from '../storage/logs.js';
import { JsonlParser } from '../parser/jsonl.js';
import { extractThreadId } from '../parser/events.js';
import type { RunnerOptions, JobRunner } from './types.js';
import type { Job, RunnerResult } from '../types/job.js';

export class CodexRunner implements JobRunner {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
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

    // Mark job as running
    updateJobStatus(
      job.id,
      'running',
      {
        started_at: startedAt,
        log_path: logPath,
        error_message: null,
      },
      this.db
    );

    const logStream = createJobLogStream(job.id);
    let threadId: string | null = job.thread_id;
    let stderrContent = '';

    const args = ['exec', '--json', '--sandbox', 'workspace-write', '-C', job.repo_path, job.prompt];

    const parser = new JsonlParser({
      onEvent: (event) => {
        options.onEvent?.(event);

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
      let childProc: ReturnType<typeof defaultSpawn>;

      try {
        childProc = spawnFn(codexBin, args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...options.env,
          },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const completedAt = new Date().toISOString();
        updateJobStatus(
          job.id,
          'failed',
          {
            completed_at: completedAt,
            exit_code: -1,
            error_message: errorMsg,
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
        const completedAt = new Date().toISOString();
        updateJobStatus(
          job.id,
          'failed',
          {
            completed_at: completedAt,
            exit_code: -1,
            error_message: err.message,
          },
          this.db
        );
        parser.flush();
        logStream.end();
        resolve({
          jobId: job.id,
          threadId,
          exitCode: -1,
          logPath,
          errorMessage: err.message,
          durationMs: Date.now() - startTime,
        });
      });

      childProc.on('close', (code: number | null) => {
        parser.flush();
        logStream.end();

        const exitCode = code ?? 0;
        const isSuccess = exitCode === 0;
        const status = isSuccess ? 'completed' : 'failed';
        const completedAt = new Date().toISOString();
        const errorMessage = isSuccess ? null : (stderrContent.trim() || `Process exited with code ${exitCode}`);

        updateJobStatus(
          job.id,
          status,
          {
            completed_at: completedAt,
            exit_code: exitCode,
            error_message: errorMessage,
            thread_id: threadId,
          },
          this.db
        );

        resolve({
          jobId: job.id,
          threadId,
          exitCode,
          logPath,
          errorMessage,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
