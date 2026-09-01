import type { JobRunner, RunnerOptions } from '../runner/types.js';

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
}

export interface WorkerStatus {
  isRunning: boolean;
  activeJobId: number | null;
  processedCount: number;
}
