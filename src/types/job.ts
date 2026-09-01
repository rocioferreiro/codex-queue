export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: number;
  prompt: string;
  repo_path: string;
  status: JobStatus;
  thread_id: string | null;
  log_path: string | null;
  exit_code: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreateJobInput {
  prompt: string;
  repo_path?: string;
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
  [key: string]: unknown;
}

export interface RunnerResult {
  jobId: number;
  threadId: string | null;
  exitCode: number;
  logPath: string;
  errorMessage: string | null;
  durationMs: number;
}
