export interface DaemonState {
  pid: number;
  instanceId: string;
  startedAt: string;
  version: string;
  cwd: string;
  logPath: string;
}

export interface DaemonStatusResult {
  isRunning: boolean;
  state: DaemonState | null;
  isStale: boolean;
}

export interface SpawnDaemonOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  binPath?: string;
  pollIntervalMs?: number;
  spawnFn?: typeof import('node:child_process').spawn;
}
