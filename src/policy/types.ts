import type { JobStatus, ResetSource } from '../types/job.js';

export interface RetryDecision {
  shouldRetry: boolean;
  nextStatus: JobStatus;
  nextAttemptAt: string | null;
  delayMs: number;
  reason: string;
  resetSource?: ResetSource;
  rawClock?: string;
}

export interface RetryPolicyConfig {
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  safetyBufferMs?: number;
  maxAttempts?: number;
  usageLimitInitialFallbackMs?: number;
  usageLimitMaxFallbackMs?: number;
}
