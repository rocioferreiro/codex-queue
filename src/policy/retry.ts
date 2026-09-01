import type { ErrorClassification } from '../classifier/types.js';
import type { RetryDecision, RetryPolicyConfig } from './types.js';

export const DEFAULT_RETRY_CONFIG: Required<RetryPolicyConfig> = {
  initialDelayMs: 30_000,                  // 30 seconds for rate_limit/temporary
  maxDelayMs: 3_600_000,                   // 1 hour
  backoffMultiplier: 2,
  safetyBufferMs: 60_000,                  // 60 seconds after parsed reset
  maxAttempts: 20,
  usageLimitInitialFallbackMs: 600_000,    // 10 minutes for usage limit without parsed date
  usageLimitMaxFallbackMs: 3_600_000,      // 60 minutes
};

/**
 * Calculates exponential backoff for general transient/rate-limit errors.
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
 * Calculates fallback backoff for usage limits when no reset timestamp is available.
 * 1st attempt: 10 min
 * 2nd attempt: 20 min
 * 3rd attempt: 40 min
 * 4th+ attempt: capped at 60 min
 */
export function calculateUsageLimitFallbackBackoffMs(
  attempt: number,
  config: RetryPolicyConfig = {}
): number {
  const initial = config.usageLimitInitialFallbackMs ?? DEFAULT_RETRY_CONFIG.usageLimitInitialFallbackMs;
  const max = config.usageLimitMaxFallbackMs ?? DEFAULT_RETRY_CONFIG.usageLimitMaxFallbackMs;
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
      // Check if resetAt is valid and in the future relative to referenceDate
      if (classification.resetAt && classification.resetAt.getTime() > referenceDate.getTime()) {
        const targetTime = new Date(classification.resetAt.getTime() + safetyBuffer);
        const delayMs = Math.max(0, targetTime.getTime() - referenceDate.getTime());
        const resetSource = classification.resetSource || 'parsed_absolute';
        return {
          shouldRetry: true,
          nextStatus: 'waiting_limit',
          nextAttemptAt: targetTime.toISOString(),
          delayMs,
          resetSource,
          reason: `Usage limit reached; retrying at ${targetTime.toISOString()} (+60s safety buffer)`,
        };
      } else {
        const backoffMs = calculateUsageLimitFallbackBackoffMs(attempt, config);
        const targetTime = new Date(referenceDate.getTime() + backoffMs);
        return {
          shouldRetry: true,
          nextStatus: 'waiting_limit',
          nextAttemptAt: targetTime.toISOString(),
          delayMs: backoffMs,
          resetSource: 'fallback_backoff',
          reason: `Usage limit reached without future reset timestamp; fallback backoff (${Math.round(backoffMs / 60000)}m)`,
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
        resetSource: 'fallback_backoff',
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
        resetSource: 'fallback_backoff',
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
