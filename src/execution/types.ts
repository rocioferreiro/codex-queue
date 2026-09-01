import type { Job, RunnerResult, FailureKind, ResetSource } from '../types/job.js';
import type { RunnerOptions } from '../runner/types.js';

export interface ExecutionOptions extends RunnerOptions {
  verbose?: boolean;
}

export interface ExecutionResult {
  job: Job;
  runnerResult: RunnerResult;
}
