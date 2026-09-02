export type JobStatus =
  | 'pending'
  | 'running'
  | 'waiting_limit'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type FailureKind = 'usage_limit' | 'rate_limit' | 'temporary' | 'auth' | 'sandbox' | 'unknown';

export type PriorityLevel = 'low' | 'normal' | 'high';

export type ResetSource =
  | 'structured'
  | 'parsed_absolute'
  | 'parsed_relative'
  | 'parsed_clock_time'
  | 'fallback_backoff';

export type ErrorSourceType =
  | 'turn_failed'
  | 'jsonl_error'
  | 'structured_error'
  | 'stderr_known'
  | 'stderr_generic';

export const PRIORITY_MAP: Record<PriorityLevel, number> = {
  low: -10,
  normal: 0,
  high: 10,
};

export function parsePriority(val: PriorityLevel | string | number | undefined): number {
  if (typeof val === 'number') return val;
  if (!val) return PRIORITY_MAP.normal;
  const lower = val.toLowerCase().trim();
  if (lower === 'high') return PRIORITY_MAP.high;
  if (lower === 'low') return PRIORITY_MAP.low;
  if (lower === 'normal') return PRIORITY_MAP.normal;
  const num = parseInt(val, 10);
  return isNaN(num) ? PRIORITY_MAP.normal : num;
}

export interface Job {
  id: number;
  prompt: string;
  repo_path: string;
  codex_home: string | null;
  status: JobStatus;
  thread_id: string | null;
  log_path: string | null;
  exit_code: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  failure_kind: FailureKind | null;
  priority: number;
}

export interface CreateJobInput {
  prompt: string;
  repo_path?: string;
  /** Codex home directory to use for this job. Defaults to CODEX_HOME at creation time. */
  codex_home?: string;
  priority?: PriorityLevel | number | string;
}

export interface JobFilter {
  status?: JobStatus;
  limit?: number;
  offset?: number;
}

export interface CodexParsedEvent {
  type?: string;
  thread_id?: string;
  session_id?: string;
  error?: unknown;
  message?: unknown;
  [key: string]: unknown;
}

export interface RunnerResult {
  jobId: number;
  threadId: string | null;
  exitCode: number;
  logPath: string;
  errorMessage: string | null;
  durationMs: number;
  status: 'completed' | 'codex_failure' | 'aborted';
  failureKind?: FailureKind | null;
  resetSource?: ResetSource | null;
  rawExtractedClock?: string | null;
  errorSourceType?: ErrorSourceType;
  errorSourceDescription?: string;
}
