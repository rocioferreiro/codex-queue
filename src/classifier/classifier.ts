import type { FailureKind } from '../types/job.js';
import type { ErrorClassification, StructuredErrorInput } from './types.js';
import { parseResetDatetime } from './reset-parser.js';

/**
 * Classifies an error from Codex execution into a standardized failure kind.
 * Prioritizes structured error fields, falling back to human-readable message inspection.
 */
export function classifyError(
  input: string | StructuredErrorInput | unknown,
  referenceDate: Date = new Date()
): ErrorClassification {
  if (!input) {
    return {
      kind: 'unknown',
      message: 'Unknown empty error',
      resetAt: null,
    };
  }

  // 1. If structured input object is passed
  if (typeof input === 'object' && input !== null) {
    const obj = input as StructuredErrorInput;
    const code = typeof obj.code === 'string' ? obj.code.toLowerCase() : '';
    const message = typeof obj.message === 'string' ? obj.message : JSON.stringify(input);
    const rawCode = obj.code ? String(obj.code) : undefined;

    if (code.includes('usage_limit') || code.includes('quota') || code.includes('insufficient_quota')) {
      const resetAt = obj.reset_at ? new Date(obj.reset_at) : parseResetDatetime(message, referenceDate);
      return {
        kind: 'usage_limit',
        message,
        resetAt: resetAt && !isNaN(resetAt.getTime()) ? resetAt : null,
        rawCode,
      };
    }

    if (code.includes('rate_limit') || code === '429' || code === 'too_many_requests') {
      return {
        kind: 'rate_limit',
        message,
        resetAt: parseResetDatetime(message, referenceDate),
        rawCode,
      };
    }

    if (code.includes('auth') || code.includes('unauthorized') || code === '401' || code === '403') {
      return {
        kind: 'auth',
        message,
        resetAt: null,
        rawCode,
      };
    }

    if (code.includes('sandbox') || code.includes('permission_denied')) {
      return {
        kind: 'sandbox',
        message,
        resetAt: null,
        rawCode,
      };
    }

    if (code.includes('temporary') || code.includes('timeout') || code === '500' || code === '502' || code === '503' || code === '504') {
      return {
        kind: 'temporary',
        message,
        resetAt: parseResetDatetime(message, referenceDate),
        rawCode,
      };
    }

    // If code wasn't matched directly, fall through to text classification on message
    return classifyText(message, rawCode, referenceDate);
  }

  // 2. Text-based classification
  const text = String(input);
  return classifyText(text, undefined, referenceDate);
}

function classifyText(text: string, rawCode?: string, referenceDate: Date = new Date()): ErrorClassification {
  const lower = text.toLowerCase();

  // Usage limit / Quota
  if (
    lower.includes('usage limit') ||
    lower.includes('usage_limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('insufficient_quota') ||
    lower.includes('hit your usage limit') ||
    lower.includes('plan limit') ||
    lower.includes('monthly limit')
  ) {
    const resetAt = parseResetDatetime(text, referenceDate);
    return {
      kind: 'usage_limit',
      message: text,
      resetAt,
      rawCode,
    };
  }

  // Rate limit
  if (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  ) {
    return {
      kind: 'rate_limit',
      message: text,
      resetAt: parseResetDatetime(text, referenceDate),
      rawCode,
    };
  }

  // Auth
  if (
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('403 forbidden') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication failed') ||
    lower.includes('auth error') ||
    lower.includes('codex login') ||
    lower.includes('invalid_api_key') ||
    lower.includes('token expired')
  ) {
    return {
      kind: 'auth',
      message: text,
      resetAt: null,
      rawCode,
    };
  }

  // Sandbox
  if (
    lower.includes('sandbox error') ||
    lower.includes('sandbox violation') ||
    lower.includes('operation not permitted') ||
    lower.includes('sandbox policy') ||
    lower.includes('blocked by sandbox')
  ) {
    return {
      kind: 'sandbox',
      message: text,
      resetAt: null,
      rawCode,
    };
  }

  // Temporary / Network / 5xx
  if (
    lower.includes('500 internal server') ||
    lower.includes('502 bad gateway') ||
    lower.includes('503 service unavailable') ||
    lower.includes('504 gateway timeout') ||
    lower.includes('service unavailable') ||
    lower.includes('connection reset') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('server error')
  ) {
    return {
      kind: 'temporary',
      message: text,
      resetAt: parseResetDatetime(text, referenceDate),
      rawCode,
    };
  }

  return {
    kind: 'unknown',
    message: text,
    resetAt: null,
    rawCode,
  };
}
