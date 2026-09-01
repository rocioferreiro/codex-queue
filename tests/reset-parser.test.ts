import { describe, it, expect } from 'vitest';
import { parseResetDatetime, parseResetDatetimeWithSource } from '../src/classifier/reset-parser.js';

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

  describe('Clock-only time parsing', () => {
    it('parses "try again at 3:09 PM" when later today', () => {
      // Local reference: Sep 1, 2026 13:45 (1:45 PM)
      const reference = new Date(2026, 8, 1, 13, 45, 0);
      const text = "You've hit your usage limit. Upgrade to Pro (...), or try again at 3:09 PM.";
      const parsed = parseResetDatetimeWithSource(text, reference);

      expect(parsed).not.toBeNull();
      expect(parsed?.source).toBe('parsed_clock_time');
      expect(parsed?.rawClock).toBe('3:09 PM');
      expect(parsed?.date.getFullYear()).toBe(2026);
      expect(parsed?.date.getMonth()).toBe(8);
      expect(parsed?.date.getDate()).toBe(1); // Today
      expect(parsed?.date.getHours()).toBe(15);
      expect(parsed?.date.getMinutes()).toBe(9);
    });

    it('parses "try again at 8:09 PM" when already passed today -> advances to tomorrow', () => {
      // Local reference: Sep 1, 2026 21:00 (9:00 PM)
      const reference = new Date(2026, 8, 1, 21, 0, 0);
      const text = "You've hit your usage limit. Upgrade to Pro (...), or try again at 8:09 PM.";
      const parsed = parseResetDatetimeWithSource(text, reference);

      expect(parsed).not.toBeNull();
      expect(parsed?.source).toBe('parsed_clock_time');
      expect(parsed?.date.getFullYear()).toBe(2026);
      expect(parsed?.date.getMonth()).toBe(8);
      expect(parsed?.date.getDate()).toBe(2); // Tomorrow
      expect(parsed?.date.getHours()).toBe(20);
      expect(parsed?.date.getMinutes()).toBe(9);
    });

    it('parses "try again at 11:05 AM"', () => {
      const reference = new Date(2026, 8, 1, 9, 0, 0);
      const text = "Limit reached. Try again at 11:05 AM";
      const parsed = parseResetDatetimeWithSource(text, reference);

      expect(parsed?.date.getHours()).toBe(11);
      expect(parsed?.date.getMinutes()).toBe(5);
    });

    it('parses "noon" and "midnight"', () => {
      const reference = new Date(2026, 8, 1, 10, 0, 0);
      const noonParsed = parseResetDatetimeWithSource("Try again at noon", reference);
      expect(noonParsed?.date.getHours()).toBe(12);
      expect(noonParsed?.date.getMinutes()).toBe(0);

      const midnightParsed = parseResetDatetimeWithSource("Try again at midnight", reference);
      expect(midnightParsed?.date.getDate()).toBe(2); // Tomorrow midnight
      expect(midnightParsed?.date.getHours()).toBe(0);
      expect(midnightParsed?.date.getMinutes()).toBe(0);
    });

    it('handles clock values near midnight transition', () => {
      // Local reference: Sep 1, 2026 23:55
      const reference = new Date(2026, 8, 1, 23, 55, 0);
      const text = "Try again at 12:05 AM";
      const parsed = parseResetDatetimeWithSource(text, reference);

      expect(parsed?.date.getDate()).toBe(2); // Tomorrow
      expect(parsed?.date.getHours()).toBe(0);
      expect(parsed?.date.getMinutes()).toBe(5);
    });

    it('returns null for invalid / malformed clock values', () => {
      expect(parseResetDatetimeWithSource("Try again at 99:99 PM")).toBeNull();
      expect(parseResetDatetimeWithSource("Try again at 25:00 AM")).toBeNull();
    });
  });

  it('returns null for malformed or non-date strings', () => {
    expect(parseResetDatetime("You've hit your usage limit. Try again later.")).toBeNull();
    expect(parseResetDatetime("Some random error message without any date")).toBeNull();
    expect(parseResetDatetime("")).toBeNull();
  });
});
