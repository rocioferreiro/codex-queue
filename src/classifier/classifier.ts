import type { FailureKind, ResetSource, ErrorSourceType } from '../types/job.js';
import type { ErrorClassification, StructuredErrorInput } from './types.js';
import { parseResetDatetimeWithSource } from './reset-parser.js';

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
      resetSource: undefined,
      errorSourceType: 'stderr_generic',
      errorSourceDescription: 'empty error',
    };
  }

  // 1. If structured input object is passed
  if (typeof input === 'object' && input !== null) {
    const obj = input as StructuredErrorInput;
    const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    const code = typeof obj.code === 'string' ? obj.code.toLowerCase() : '';

    let errorSourceType: ErrorSourceType = 'structured_error';
    let errorSourceDescription = 'structured error';

    if (type === 'turn.failed' || type === 'turn_failed') {
      errorSourceType = 'turn_failed';
      errorSourceDescription = 'JSONL turn.failed';
    } else if (type === 'error') {
      errorSourceType = 'jsonl_error';
      errorSourceDescription = 'JSONL error event';
    }

    // Extract message from obj.error?.message, obj.message, or string representation
    let message = '';
    if (obj.error && typeof obj.error === 'object') {
      const innerErr = obj.error as Record<string, unknown>;
      if (typeof innerErr.message === 'string') {
        message = innerErr.message;
      } else if (typeof innerErr.code === 'string') {
        message = `${innerErr.code}: ${JSON.stringify(innerErr)}`;
      } else {
        message = JSON.stringify(obj.error);
      }
    } else if (typeof obj.message === 'string') {
      message = obj.message;
    } else {
      message = JSON.stringify(input);
    }

    const rawCode = obj.code ? String(obj.code) : undefined;

    if (code.includes('usage_limit') || code.includes('quota') || code.includes('insufficient_quota') || message.toLowerCase().includes('usage limit')) {
      let resetAt: Date | null = null;
      let resetSource: ResetSource | undefined = undefined;
      let rawClock: string | undefined = undefined;

      if (obj.reset_at) {
        const d = new Date(obj.reset_at);
        if (!isNaN(d.getTime())) {
          resetAt = d;
          resetSource = 'structured';
        }
      }

      if (!resetAt) {
        const parsed = parseResetDatetimeWithSource(message, referenceDate);
        if (parsed) {
          resetAt = parsed.date;
          resetSource = parsed.source;
          rawClock = parsed.rawClock;
        }
      }

      return {
        kind: 'usage_limit',
        message,
        resetAt,
        rawCode,
        resetSource,
        rawClock,
        errorSourceType,
        errorSourceDescription,
      };
    }

    if (code.includes('rate_limit') || code === '429' || code === 'too_many_requests' || message.toLowerCase().includes('rate limit')) {
      const parsed = parseResetDatetimeWithSource(message, referenceDate);
      return {
        kind: 'rate_limit',
        message,
        resetAt: parsed ? parsed.date : null,
        resetSource: parsed ? parsed.source : undefined,
        rawClock: parsed?.rawClock,
        rawCode,
        errorSourceType,
        errorSourceDescription,
      };
    }

    if (code.includes('auth') || code.includes('unauthorized') || code === '401' || code === '403' || message.toLowerCase().includes('unauthorized')) {
      return {
        kind: 'auth',
        message,
        resetAt: null,
        rawCode,
        errorSourceType,
        errorSourceDescription,
      };
    }

    if (code.includes('sandbox') || code.includes('permission_denied') || message.toLowerCase().includes('sandbox')) {
      return {
        kind: 'sandbox',
        message,
        resetAt: null,
        rawCode,
        errorSourceType,
        errorSourceDescription,
      };
    }

    if (
      code.includes('temporary') ||
      code.includes('timeout') ||
      code === '500' ||
      code === '502' ||
      code === '503' ||
      code === '504'
    ) {
      const parsed = parseResetDatetimeWithSource(message, referenceDate);
      return {
        kind: 'temporary',
        message,
        resetAt: parsed ? parsed.date : null,
        resetSource: parsed ? parsed.source : undefined,
        rawClock: parsed?.rawClock,
        rawCode,
        errorSourceType,
        errorSourceDescription,
      };
    }

    // Fall through to text classification on message
    const textClassified = classifyText(message, rawCode, referenceDate);
    return {
      ...textClassified,
      errorSourceType,
      errorSourceDescription,
    };
  }

  // 2. Text-based classification (stderr fallback)
  const text = String(input);
  return classifyText(text, undefined, referenceDate);
}

function classifyText(text: string, rawCode?: string, referenceDate: Date = new Date()): ErrorClassification {
  const lower = text.toLowerCase();

  // Usage limit / Quota / Try again at
  if (
    lower.includes('usage limit') ||
    lower.includes('usage_limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('insufficient_quota') ||
    lower.includes('hit your usage limit') ||
    lower.includes('plan limit') ||
    lower.includes('monthly limit') ||
    lower.includes('try again at') ||
    lower.includes('try again in')
  ) {
    const parsed = parseResetDatetimeWithSource(text, referenceDate);
    return {
      kind: 'usage_limit',
      message: text,
      resetAt: parsed ? parsed.date : null,
      resetSource: parsed ? parsed.source : undefined,
      rawClock: parsed?.rawClock,
      rawCode,
      errorSourceType: 'stderr_known',
      errorSourceDescription: 'stderr message',
    };
  }

  // Rate limit
  if (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  ) {
    const parsed = parseResetDatetimeWithSource(text, referenceDate);
    return {
      kind: 'rate_limit',
      message: text,
      resetAt: parsed ? parsed.date : null,
      resetSource: parsed ? parsed.source : undefined,
      rawClock: parsed?.rawClock,
      rawCode,
      errorSourceType: 'stderr_known',
      errorSourceDescription: 'stderr message',
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
      errorSourceType: 'stderr_known',
      errorSourceDescription: 'stderr message',
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
      errorSourceType: 'stderr_known',
      errorSourceDescription: 'stderr message',
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
    const parsed = parseResetDatetimeWithSource(text, referenceDate);
    return {
      kind: 'temporary',
      message: text,
      resetAt: parsed ? parsed.date : null,
      resetSource: parsed ? parsed.source : undefined,
      rawClock: parsed?.rawClock,
      rawCode,
      errorSourceType: 'stderr_known',
      errorSourceDescription: 'stderr message',
    };
  }

  return {
    kind: 'unknown',
    message: text,
    resetAt: null,
    rawCode,
    errorSourceType: 'stderr_generic',
    errorSourceDescription: 'stderr message',
  };
}
