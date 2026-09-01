import type Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';
import { getJobById, updateJobStatus } from '../db/jobs.js';
import { CodexRunner } from '../runner/codex-runner.js';
import type { JobRunner } from '../runner/types.js';
import type { Job, RunnerResult } from '../types/job.js';
import type { ExecutionOptions, ExecutionResult } from './types.js';

export class JobExecutor {
  private db: Database.Database;
  private runner: JobRunner;

  constructor(db?: Database.Database, runner?: JobRunner) {
    this.db = db || getDatabase();
    this.runner = runner || new CodexRunner(this.db);
  }

  public getRunner(): JobRunner {
    return this.runner;
  }

  /**
   * Execute a single job following the standard authoritative lifecycle.
   * Shared by both `cq worker` and standalone `cq run <id>`.
   */
  public async executeJob(jobId: number, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const job = getJobById(jobId, this.db);
    if (!job) {
      throw new Error(`Job #${jobId} not found`);
    }

    // If job was not already claimed and transitioned to running (e.g. standalone cq run),
    // atomically transition it to running, clear next_attempt_at, and increment attempts by 1.
    if (job.status !== 'running') {
      const startedAt = new Date().toISOString();
      const attempts = (job.attempts || 0) + 1;
      updateJobStatus(
        job.id,
        'running',
        {
          started_at: startedAt,
          next_attempt_at: null,
          attempts,
        },
        this.db
      );
      job.status = 'running';
      job.started_at = startedAt;
      job.next_attempt_at = null;
      job.attempts = attempts;
    }

    // Run execution with the runner
    const runnerResult = await this.runner.run(job, {
      ...options,
      skipAttemptIncrement: true,
    });

    const finalJob = getJobById(job.id, this.db) || job;

    return {
      job: finalJob,
      runnerResult,
    };
  }

  public abort(reason?: string): void {
    this.runner.abort(reason);
  }
}
