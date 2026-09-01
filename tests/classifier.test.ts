import { describe, it, expect } from 'vitest';
import { classifyError } from '../src/classifier/index.js';

describe('Error Classifier', () => {
  it('classifies usage limit errors and extracts reset datetime', () => {
    const errorText = "You've hit your usage limit. Try again at Sep 1st, 2026 5:32 PM";
    const classification = classifyError(errorText);

    expect(classification.kind).toBe('usage_limit');
    expect(classification.resetAt).not.toBeNull();
    expect(classification.resetAt?.getFullYear()).toBe(2026);
  });

  it('classifies usage limit without extractable date', () => {
    const errorText = "You've hit your usage limit. Check your plan details.";
    const classification = classifyError(errorText);

    expect(classification.kind).toBe('usage_limit');
    expect(classification.resetAt).toBeNull();
  });

  it('classifies rate limit errors', () => {
    const errorText = "429 Too Many Requests: Rate limit reached, slow down.";
    const classification = classifyError(errorText);

    expect(classification.kind).toBe('rate_limit');
  });

  it('classifies temporary server / network errors', () => {
    expect(classifyError("503 Service Unavailable").kind).toBe('temporary');
    expect(classifyError("502 Bad Gateway").kind).toBe('temporary');
    expect(classifyError("ECONNRESET: connection reset by peer").kind).toBe('temporary');
    expect(classifyError("ETIMEDOUT").kind).toBe('temporary');
  });

  it('classifies auth errors', () => {
    expect(classifyError("401 Unauthorized: Invalid API key").kind).toBe('auth');
    expect(classifyError("Please run `codex login` to authenticate").kind).toBe('auth');
    expect(classifyError("Authentication failed: expired token").kind).toBe('auth');
  });

  it('classifies sandbox errors', () => {
    expect(classifyError("Operation not permitted: sandbox violation").kind).toBe('sandbox');
    expect(classifyError("Command blocked by sandbox policy").kind).toBe('sandbox');
  });

  it('classifies unknown errors', () => {
    expect(classifyError("Syntax error in user prompt or unhandled exception").kind).toBe('unknown');
  });

  it('prefers structured error object if provided', () => {
    const structured = {
      code: 'usage_limit_reached',
      message: 'Plan quota exceeded',
    };
    const classification = classifyError(structured);
    expect(classification.kind).toBe('usage_limit');
    expect(classification.rawCode).toBe('usage_limit_reached');
  });
});
