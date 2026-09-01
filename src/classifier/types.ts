import type { FailureKind, ResetSource } from '../types/job.js';

export interface ErrorClassification {
  kind: FailureKind;
  message: string;
  resetAt: Date | null;
  rawCode?: string;
  resetSource?: ResetSource;
}

export interface StructuredErrorInput {
  code?: string;
  message?: string;
  type?: string;
  error?: unknown;
  reset_at?: string | number;
  [key: string]: unknown;
}
