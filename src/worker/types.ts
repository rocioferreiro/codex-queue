import type { JobRunner, RunnerOptions } from '../runner/types.js';
import type { JobStatus } from '../types/job.js';

export type WorkerNotification = (jobId: number, status: JobStatus, detail?: string) => void;

export interface WorkerOptions {
  /**
   * Interval in milliseconds between polling checks when queue is idle.
   * Default: 1000ms
   */
  pollIntervalMs?: number;
  /**
   * Custom runner instance (useful for testing and mocking).
   */
  runner?: JobRunner;
  /**
   * Custom logger function. Defaults to console.log.
   */
  onLog?: (message: string) => void;
  /**
   * Enable verbose output for observability (e.g. usage limit classification details).
   */
  verbose?: boolean;
  /**
   * Options to pass down to each job runner invocation.
   */
  runnerOptions?: RunnerOptions;
  /** Desktop notification callback. Defaults to the platform notification adapter. */
  notify?: WorkerNotification;
}

export interface WorkerStatus {
  isRunning: boolean;
  activeJobId: number | null;
  processedCount: number;
}
