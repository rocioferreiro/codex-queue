import type { Job, RunnerResult, FailureKind, ResetSource } from '../types/job.js';

export interface RunnerOptions {
  /**
   * Custom path or binary name for codex. Defaults to 'codex'.
   */
  codexBin?: string;
  /**
   * Optional custom environment variables to pass to the spawned process (e.g. CODEX_HOME).
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Callback fired when a raw stdout log line is received.
   */
  onLogLine?: (line: string) => void;
  /**
   * Callback fired when a parsed JSONL event is decoded.
   */
  onEvent?: (event: unknown) => void;
  /**
   * Callback fired when a thread_id is first detected and persisted.
   */
  onThreadId?: (threadId: string) => void;
  /**
   * Callback fired when stderr data is received.
   */
  onStderr?: (chunk: string) => void;
  /**
   * Callback fired when an error is classified.
   */
  onClassifiedError?: (
    kind: FailureKind,
    message: string,
    nextAttemptAt: string | null,
    resetSource?: ResetSource,
    extractedResetTime?: string | null
  ) => void;
  /**
   * Custom spawn function for unit testing.
   */
  spawnFn?: typeof import('node:child_process').spawn;
  /**
   * Reference date for time-based calculations (useful for testing).
   */
  referenceDate?: Date;
  /**
   * If true, runner skips incrementing attempts count.
   */
  skipAttemptIncrement?: boolean;
}

export interface JobRunner {
  run(job: Job, options?: RunnerOptions): Promise<RunnerResult>;
  abort(reason?: string): void;
}
