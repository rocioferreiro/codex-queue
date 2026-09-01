import { describe, it, expect } from 'vitest';
import { decideRetryAction, calculateBackoffMs, calculateUsageLimitFallbackBackoffMs } from '../src/policy/retry.js';
import type { ErrorClassification } from '../src/classifier/types.js';

describe('Retry Policy', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('schedules retry for usage_limit with reset time + 60s safety buffer', () => {
    const resetTime = new Date('2026-09-01T12:30:00.000Z');
    const classification: ErrorClassification = {
      kind: 'usage_limit',
      message: 'Usage limit reached',
      resetAt: resetTime,
    };

    const action = decideRetryAction(classification, 1, now);
    expect(action.shouldRetry).toBe(true);
    expect(action.nextStatus).toBe('waiting_limit');
    expect(action.nextAttemptAt).not.toBeNull();

    // 12:30:00 + 60s = 12:31:00
    const expected = new Date('2026-09-01T12:31:00.000Z');
    expect(new Date(action.nextAttemptAt!).getTime()).toBe(expected.getTime());
  });

  it('schedules retry with 10-minute fallback backoff for usage_limit without reset time', () => {
    const classification: ErrorClassification = {
      kind: 'usage_limit',
      message: 'Usage limit reached without date',
      resetAt: null,
    };

    const action = decideRetryAction(classification, 1, now);
    expect(action.shouldRetry).toBe(true);
    expect(action.nextStatus).toBe('waiting_limit');
    expect(action.nextAttemptAt).not.toBeNull();
    const delay = new Date(action.nextAttemptAt!).getTime() - now.getTime();
    expect(delay).toBeGreaterThanOrEqual(600_000); // 10 minutes
  });

  it('schedules retry for rate_limit with exponential backoff', () => {
    const classification: ErrorClassification = {
      kind: 'rate_limit',
      message: '429 Too Many Requests',
      resetAt: null,
    };

    const action = decideRetryAction(classification, 1, now);
    expect(action.shouldRetry).toBe(true);
    expect(action.nextStatus).toBe('waiting_limit');
    expect(action.nextAttemptAt).not.toBeNull();
  });

  it('schedules retry for temporary server errors', () => {
    const classification: ErrorClassification = {
      kind: 'temporary',
      message: '503 Service Unavailable',
      resetAt: null,
    };

    const action = decideRetryAction(classification, 1, now);
    expect(action.shouldRetry).toBe(true);
    expect(action.nextStatus).toBe('waiting_limit');
  });

  it('fails immediately for auth errors without retry', () => {
    const classification: ErrorClassification = {
      kind: 'auth',
      message: '401 Unauthorized',
      resetAt: null,
    };

    const action = decideRetryAction(classification, 1, now);
    expect(action.shouldRetry).toBe(false);
    expect(action.nextStatus).toBe('failed');
    expect(action.nextAttemptAt).toBeNull();
  });

  it('fails immediately for sandbox errors without retry', () => {
    const classification: ErrorClassification = {
      kind: 'sandbox',
      message: 'Sandbox permission denied',
      resetAt: null,
    };

    const action = decideRetryAction(classification, 1, now);
    expect(action.shouldRetry).toBe(false);
    expect(action.nextStatus).toBe('failed');
    expect(action.nextAttemptAt).toBeNull();
  });

  it('fails by default for unknown errors', () => {
    const classification: ErrorClassification = {
      kind: 'unknown',
      message: 'Syntax error',
      resetAt: null,
    };

    const action = decideRetryAction(classification, 1, now);
    expect(action.shouldRetry).toBe(false);
    expect(action.nextStatus).toBe('failed');
  });

  it('respects exponential backoff bounds and multiplier', () => {
    const b1 = calculateBackoffMs(1);
    const b2 = calculateBackoffMs(2);
    const b3 = calculateBackoffMs(3);
    const b100 = calculateBackoffMs(100);

    expect(b1).toBe(30_000); // 30s
    expect(b2).toBe(60_000); // 60s
    expect(b3).toBe(120_000); // 120s
    expect(b100).toBe(3600_000); // capped at 1h
  });

  it('calculates usage limit fallback backoff (10m, 20m, 40m, 60m)', () => {
    expect(calculateUsageLimitFallbackBackoffMs(1)).toBe(600_000); // 10m
    expect(calculateUsageLimitFallbackBackoffMs(2)).toBe(1_200_000); // 20m
    expect(calculateUsageLimitFallbackBackoffMs(3)).toBe(2_400_000); // 40m
    expect(calculateUsageLimitFallbackBackoffMs(4)).toBe(3_600_000); // capped at 60m
  });
});
