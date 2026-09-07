export function parseScheduledTime(value: string): string {
  const date = new Date(value);
  if (!value.trim() || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date/time "${value}". Use an ISO 8601 value, for example 2026-09-07T10:00:00-03:00.`);
  }

  return date.toISOString();
}
