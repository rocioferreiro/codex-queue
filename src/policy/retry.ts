import type { ErrorClassification } from '../classifier/types.js';
import type { RetryDecision, RetryPolicyConfig } from './types.js';

export const DEFAULT_RETRY_CONFIG: Required<RetryPolicyConfig> = {
  initialDelayMs: 30_000,      // 30 seconds
  maxDelayMs: 3_600_000,       // 1 hour
  backoffMultiplier: 2,
  safetyBufferMs: 60_000,      // 60 seconds after reset
  maxAttempts: 20,
};

/**
 * Calculates exponential backoff bounded by maxDelayMs.
 */
export function calculateBackoffMs(
  attempt: number,
  config: RetryPolicyConfig = {}
): number {
  const initial = config.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs;
  const max = config.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs;
  const multiplier = config.backoffMultiplier ?? DEFAULT_RETRY_CONFIG.backoffMultiplier;

  const exp = Math.max(0, attempt - 1);
  const calculated = initial * Math.pow(multiplier, exp);
  return Math.min(max, calculated);
}

/**
 * Decides whether to retry a job and when, based on its error classification.
 */
export function decideRetryAction(
  classification: ErrorClassification,
  attempt: number = 1,
  referenceDate: Date = new Date(),
  config: RetryPolicyConfig = {}
): RetryDecision {
  const safetyBuffer = config.safetyBufferMs ?? DEFAULT_RETRY_CONFIG.safetyBufferMs;
  const maxAttempts = config.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts;

  if (attempt >= maxAttempts) {
    return {
      shouldRetry: false,
      nextStatus: 'failed',
      nextAttemptAt: null,
      delayMs: 0,
      reason: `Exceeded maximum attempt limit (${maxAttempts})`,
    };
  }

  switch (classification.kind) {
    case 'usage_limit': {
      if (classification.resetAt) {
        const targetTime = new Date(classification.resetAt.getTime() + safetyBuffer);
        const delayMs = Math.max(0, targetTime.getTime() - referenceDate.getTime());
        return {
          shouldRetry: true,
          nextStatus: 'waiting_limit',
          nextAttemptAt: targetTime.toISOString(),
          delayMs,
          reason: `Usage limit reached; retrying at ${targetTime.toISOString()} (+60s safety buffer)`,
        };
      } else {
        const backoffMs = calculateBackoffMs(attempt, config);
        const targetTime = new Date(referenceDate.getTime() + backoffMs);
        return {
          shouldRetry: true,
          nextStatus: 'waiting_limit',
          nextAttemptAt: targetTime.toISOString(),
          delayMs: backoffMs,
          reason: `Usage limit reached (no exact reset time); exponential backoff (${Math.round(backoffMs / 1000)}s)`,
        };
      }
    }

    case 'rate_limit': {
      const backoffMs = calculateBackoffMs(attempt, config);
      const targetTime = new Date(referenceDate.getTime() + backoffMs);
      return {
        shouldRetry: true,
        nextStatus: 'waiting_limit',
        nextAttemptAt: targetTime.toISOString(),
        delayMs: backoffMs,
        reason: `Rate limited; exponential backoff (${Math.round(backoffMs / 1000)}s)`,
      };
    }

    case 'temporary': {
      const backoffMs = calculateBackoffMs(attempt, config);
      const targetTime = new Date(referenceDate.getTime() + backoffMs);
      return {
        shouldRetry: true,
        nextStatus: 'waiting_limit',
        nextAttemptAt: targetTime.toISOString(),
        delayMs: backoffMs,
        reason: `Temporary server or network error; exponential backoff (${Math.round(backoffMs / 1000)}s)`,
      };
    }

    case 'auth':
      return {
        shouldRetry: false,
        nextStatus: 'failed',
        nextAttemptAt: null,
        delayMs: 0,
        reason: 'Authentication failure requires user intervention; failing immediately.',
      };

    case 'sandbox':
      return {
        shouldRetry: false,
        nextStatus: 'failed',
        nextAttemptAt: null,
        delayMs: 0,
        reason: 'Sandbox policy violation; failing immediately.',
      };

    case 'unknown':
    default:
      return {
        shouldRetry: false,
        nextStatus: 'failed',
        nextAttemptAt: null,
        delayMs: 0,
        reason: 'Unknown error kind; failing by default.',
      };
  }
}
