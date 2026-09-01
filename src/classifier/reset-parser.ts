import type { ResetSource } from '../types/job.js';

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export interface ParsedResetResult {
  date: Date;
  source: 'parsed_absolute' | 'parsed_relative' | 'parsed_clock_time';
  rawClock?: string;
}

/**
 * Extracts a reset datetime and source classification from human-readable Codex error messages or ISO strings.
 */
export function parseResetDatetime(
  text: string,
  referenceDate: Date = new Date()
): Date | null {
  const result = parseResetDatetimeWithSource(text, referenceDate);
  return result ? result.date : null;
}

export function parseResetDatetimeWithSource(
  text: string,
  referenceDate: Date = new Date()
): ParsedResetResult | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // 1. Relative duration: e.g. "try again in 15 minutes", "in 2 hours"
  const relativeMatch = text.match(/in\s+(\d+)\s*(minute|min|hour|hr|second|sec)s?/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const result = new Date(referenceDate.getTime());

    if (unit.startsWith('min')) {
      result.setMinutes(result.getMinutes() + amount);
      return { date: result, source: 'parsed_relative' };
    } else if (unit.startsWith('hour') || unit.startsWith('hr')) {
      result.setHours(result.getHours() + amount);
      return { date: result, source: 'parsed_relative' };
    } else if (unit.startsWith('sec')) {
      result.setSeconds(result.getSeconds() + amount);
      return { date: result, source: 'parsed_relative' };
    }
  }

  // 2. ISO 8601 Timestamp: e.g. "2026-09-01T17:32:00Z"
  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/i);
  if (isoMatch) {
    const d = new Date(isoMatch[0]);
    if (!isNaN(d.getTime())) {
      return { date: d, source: 'parsed_absolute' };
    }
  }

  // 3. Formatted Date with month: "Sep 1st, 2026 5:32 PM", "October 12, 2026 09:15 AM UTC"
  const formattedRegex = /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?(?:[,\s]+at)?[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?(?:\s*([A-Za-z0-9_+-]+))?/i;

  const match = text.match(formattedRegex);
  if (match) {
    const monthStr = match[1].toLowerCase().replace('.', '');
    const month = MONTH_MAP[monthStr];
    const day = parseInt(match[2], 10);
    const year = match[3] ? parseInt(match[3], 10) : referenceDate.getFullYear();
    let hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const seconds = match[6] ? parseInt(match[6], 10) : 0;
    const meridian = match[7] ? match[7].toUpperCase() : null;
    const tz = match[8] ? match[8].toUpperCase() : null;

    if (hours > 23 || minutes > 59 || seconds > 59) {
      return null;
    }

    if (meridian === 'PM' && hours < 12) {
      hours += 12;
    } else if (meridian === 'AM' && hours === 12) {
      hours = 0;
    }

    if (month !== undefined && !isNaN(day) && !isNaN(year)) {
      if (tz === 'UTC' || tz === 'Z' || tz === 'GMT') {
        const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
        if (!isNaN(utcDate.getTime())) {
          return { date: utcDate, source: 'parsed_absolute' };
        }
      } else {
        const localDate = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(localDate.getTime())) {
          return { date: localDate, source: 'parsed_absolute' };
        }
      }
    }
  }

  // 4. Special word times: "try again at noon", "try again at midnight"
  const specialMatch = text.match(/\bat\s+(noon|midnight)\b/i);
  if (specialMatch) {
    const word = specialMatch[1].toLowerCase();
    const hours = word === 'noon' ? 12 : 0;
    const minutes = 0;
    const candidate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      hours,
      minutes,
      0,
      0
    );

    if (candidate.getTime() <= referenceDate.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }

    return {
      date: candidate,
      source: 'parsed_clock_time',
      rawClock: word,
    };
  }

  // 5. Clock-only times: "try again at 3:09 PM", "try again at 8:09 PM", "try again at 11:05 AM"
  const clockRegex = /\bat\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/i;
  const clockMatch = text.match(clockRegex);
  if (clockMatch) {
    let hours = parseInt(clockMatch[1], 10);
    const minutes = parseInt(clockMatch[2], 10);
    const seconds = clockMatch[3] ? parseInt(clockMatch[3], 10) : 0;
    const meridian = clockMatch[4] ? clockMatch[4].toUpperCase() : null;

    if (meridian) {
      if (hours < 1 || hours > 12) return null;
      if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;

      if (meridian === 'PM' && hours < 12) {
        hours += 12;
      } else if (meridian === 'AM' && hours === 12) {
        hours = 0;
      }
    } else {
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
        return null;
      }
    }

    const rawClock = clockMatch[0].replace(/^at\s+/i, '').trim();

    // Construct in local wall-clock timezone on referenceDate's date
    const candidate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      hours,
      minutes,
      seconds,
      0
    );

    // If candidate time has already passed today, advance to tomorrow
    if (candidate.getTime() <= referenceDate.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }

    return {
      date: candidate,
      source: 'parsed_clock_time',
      rawClock,
    };
  }

  return null;
}
