import { describe, it, expect } from 'vitest';
import { parseResetDatetime } from '../src/classifier/reset-parser.js';

describe('Reset Time Parser', () => {
  it('parses formatted dates like "Sep 1st, 2026 5:32 PM"', () => {
    const text = "You've hit your usage limit. Please try again at Sep 1st, 2026 5:32 PM.";
    const result = parseResetDatetime(text, new Date('2026-09-01T12:00:00.000Z'));
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(8); // September (0-indexed: 8)
    expect(result?.getDate()).toBe(1);
    expect(result?.getHours()).toBe(17);
    expect(result?.getMinutes()).toBe(32);
  });

  it('parses formatted dates with month abbreviations: "Oct 12, 2026 09:15 AM"', () => {
    const text = "Limit reached. Try again at Oct 12, 2026 9:15 AM";
    const result = parseResetDatetime(text, new Date('2026-10-01T10:00:00.000Z'));
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(9); // October
    expect(result?.getDate()).toBe(12);
    expect(result?.getHours()).toBe(9);
    expect(result?.getMinutes()).toBe(15);
  });

  it('parses ISO-8601 timestamps', () => {
    const text = "Usage limit resets at 2026-09-01T17:32:00Z";
    const result = parseResetDatetime(text);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2026-09-01T17:32:00.000Z');
  });

  it('parses timestamps with timezone offsets like "Sep 1, 2026 5:32 PM UTC"', () => {
    const text = "Try again at Sep 1, 2026 5:32 PM UTC";
    const result = parseResetDatetime(text);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2026-09-01T17:32:00.000Z');
  });

  it('parses relative duration like "try again in 15 minutes"', () => {
    const reference = new Date('2026-09-01T12:00:00.000Z');
    const text = "Usage limit hit. Please try again in 15 minutes.";
    const result = parseResetDatetime(text, reference);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2026-09-01T12:15:00.000Z');
  });

  it('parses relative duration like "try again in 2 hours"', () => {
    const reference = new Date('2026-09-01T12:00:00.000Z');
    const text = "Usage limit hit. Try again in 2 hours";
    const result = parseResetDatetime(text, reference);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2026-09-01T14:00:00.000Z');
  });

  it('returns null for malformed or non-date strings', () => {
    expect(parseResetDatetime("You've hit your usage limit. Try again later.")).toBeNull();
    expect(parseResetDatetime("Some random error message without any date")).toBeNull();
    expect(parseResetDatetime("")).toBeNull();
  });
});
