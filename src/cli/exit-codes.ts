export const ExitCodes = {
  SUCCESS: 0,
  ERROR: 1,
  INVALID_INPUT: 2,
  DAEMON_ALREADY_RUNNING: 3,
  DAEMON_NOT_RUNNING: 4,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];
