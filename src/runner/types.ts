import type { Job, RunnerResult } from '../types/job.js';

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
   * Custom spawn function for unit testing.
   */
  spawnFn?: typeof import('node:child_process').spawn;
}

export interface JobRunner {
  run(job: Job, options?: RunnerOptions): Promise<RunnerResult>;
}
