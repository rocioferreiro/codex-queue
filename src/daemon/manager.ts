import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn as defaultSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getWorkerPidPath,
  getWorkerStatePath,
  getWorkerLogPath,
  ensureStorageDirs,
} from '../storage/paths.js';
import { isProcessAlive, verifyProcessIdentity, sendSignal } from './process.js';
import type { DaemonState, DaemonStatusResult, SpawnDaemonOptions } from './types.js';

export class DaemonAlreadyRunningError extends Error {
  public pid: number;
  constructor(pid: number) {
    super(`codex-queue daemon is already running (PID ${pid}).`);
    this.name = 'DaemonAlreadyRunningError';
    this.pid = pid;
  }
}

export class DaemonNotRunningError extends Error {
  constructor() {
    super('codex-queue daemon is not running.');
    this.name = 'DaemonNotRunningError';
  }
}

export interface DaemonManagerOptions {
  pidPath?: string;
  statePath?: string;
  logPath?: string;
  verifyIdentityFn?: (pid: number) => Promise<boolean>;
}

function findPackageRoot(fromDir: string): string {
  let curr = fromDir;
  while (curr !== path.dirname(curr)) {
    const pkgJsonPath = path.join(curr, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        if (pkg.name === 'codex-queue') {
          return curr;
        }
      } catch {}
    }
    curr = path.dirname(curr);
  }
  return fromDir;
}

export class DaemonManager {
  private pidPath: string;
  private statePath: string;
  private logPath: string;
  private verifyIdentityFn?: (pid: number) => Promise<boolean>;

  constructor(options?: DaemonManagerOptions) {
    this.pidPath = options?.pidPath || getWorkerPidPath();
    this.statePath = options?.statePath || getWorkerStatePath();
    this.logPath = options?.logPath || getWorkerLogPath();
    this.verifyIdentityFn = options?.verifyIdentityFn;
  }

  public readState(): DaemonState | null {
    try {
      if (fs.existsSync(this.statePath)) {
        const content = fs.readFileSync(this.statePath, 'utf8');
        return JSON.parse(content) as DaemonState;
      }
      if (fs.existsSync(this.pidPath)) {
        const pidStr = fs.readFileSync(this.pidPath, 'utf8').trim();
        const pid = parseInt(pidStr, 10);
        if (!isNaN(pid)) {
          return {
            pid,
            instanceId: 'legacy',
            startedAt: new Date().toISOString(),
            version: '0.4.0',
            cwd: process.cwd(),
            logPath: this.logPath,
          };
        }
      }
    } catch {
      // Corrupt state file
    }
    return null;
  }

  public writeState(state: DaemonState): void {
    ensureStorageDirs();
    fs.writeFileSync(this.pidPath, `${state.pid}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  public clearState(): void {
    try {
      if (fs.existsSync(this.pidPath)) {
        fs.unlinkSync(this.pidPath);
      }
    } catch {}

    try {
      if (fs.existsSync(this.statePath)) {
        fs.unlinkSync(this.statePath);
      }
    } catch {}
  }

  /**
   * Retrieves live daemon status, automatically detecting and cleaning up stale PID files.
   */
  public async getStatus(verifyIdentity: boolean = true): Promise<DaemonStatusResult> {
    const state = this.readState();
    if (!state) {
      return { isRunning: false, state: null, isStale: false };
    }

    const alive = isProcessAlive(state.pid);
    if (!alive) {
      this.clearState();
      return { isRunning: false, state: null, isStale: true };
    }

    if (verifyIdentity) {
      const verifier = this.verifyIdentityFn || verifyProcessIdentity;
      const verified = await verifier(state.pid);
      if (!verified) {
        this.clearState();
        return { isRunning: false, state: null, isStale: true };
      }
    }

    return { isRunning: true, state, isStale: false };
  }

  /**
   * Spawns a background detached worker process.
   */
  public async start(options: SpawnDaemonOptions = {}): Promise<DaemonState> {
    const status = await this.getStatus();
    if (status.isRunning && status.state) {
      throw new DaemonAlreadyRunningError(status.state.pid);
    }

    ensureStorageDirs();
    const spawnFn = options.spawnFn || defaultSpawn;

    // Resolve CLI binary path
    let binPath = options.binPath;
    if (!binPath) {
      const currentFile = fileURLToPath(import.meta.url);
      const pkgRoot = findPackageRoot(path.dirname(currentFile));
      const distBin = path.join(pkgRoot, 'dist/bin/cq.js');
      const srcBin = path.join(pkgRoot, 'src/cli/bin.ts');

      if (fs.existsSync(distBin)) {
        binPath = distBin;
      } else {
        binPath = srcBin;
      }
    }

    const logFd = fs.openSync(this.logPath, 'a');
    const instanceId = crypto.randomUUID();

    const spawnArgs = binPath.endsWith('.ts')
      ? ['--import', 'tsx', binPath, 'worker']
      : [binPath, 'worker'];

    const child = spawnFn(process.execPath, spawnArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        ...options.env,
        CQ_DAEMON: '1',
        CQ_INSTANCE_ID: instanceId,
      },
      cwd: options.cwd || process.cwd(),
      shell: false,
    });

    const pid = child.pid;
    if (!pid) {
      fs.closeSync(logFd);
      throw new Error('Failed to retrieve PID of spawned daemon process.');
    }

    child.unref();
    fs.closeSync(logFd);

    const daemonState: DaemonState = {
      pid,
      instanceId,
      startedAt: new Date().toISOString(),
      version: '0.4.0',
      cwd: options.cwd || process.cwd(),
      logPath: this.logPath,
    };

    this.writeState(daemonState);
    return daemonState;
  }

  /**
   * Gracefully stops the verified background daemon using SIGTERM.
   */
  public async stop(timeoutMs: number = 8000): Promise<{ stopped: boolean; wasRunning: boolean; wasStale: boolean }> {
    const status = await this.getStatus();
    if (!status.isRunning || !status.state) {
      if (status.isStale) {
        return { stopped: true, wasRunning: false, wasStale: true };
      }
      return { stopped: false, wasRunning: false, wasStale: false };
    }

    const pid = status.state.pid;

    // Send SIGTERM to the verified daemon
    sendSignal(pid, 'SIGTERM');

    // Wait for the process to exit
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!isProcessAlive(pid)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const stillAlive = isProcessAlive(pid);
    this.clearState();

    return {
      stopped: !stillAlive,
      wasRunning: true,
      wasStale: false,
    };
  }

  /**
   * Restarts the daemon.
   */
  public async restart(options: SpawnDaemonOptions = {}): Promise<DaemonState> {
    await this.stop();
    return this.start(options);
  }
}
