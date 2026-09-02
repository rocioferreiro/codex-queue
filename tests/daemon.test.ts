import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { DaemonManager, DaemonAlreadyRunningError } from '../src/daemon/manager.js';
import { isProcessAlive, verifyProcessIdentity } from '../src/daemon/process.js';
import { getWorkerPidPath, getWorkerStatePath, getWorkerLogPath } from '../src/storage/paths.js';

describe('Daemon Manager & PID Safety', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-daemon-test-'));
    process.env.CQ_HOME = tempDir;
    process.env.CQ_DB_PATH = path.join(tempDir, 'test.db');
    process.env.CQ_LOGS_DIR = path.join(tempDir, 'logs');
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('detects live process using isProcessAlive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    // Invalid / non-existent PID
    expect(isProcessAlive(99999999)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });

  it('verifies process command identity to protect against PID reuse', async () => {
    const mockExec = vi.fn().mockImplementation(async (_cmd: string, args: string[]) => {
      const pidArg = args[1];
      if (pidArg === '100') {
        return { stdout: 'node /usr/local/bin/cq worker\n' };
      }
      if (pidArg === '200') {
        return { stdout: 'google-chrome --type=renderer\n' };
      }
      throw new Error('Process not found');
    });

    const originalKill = process.kill;
    (process as any).kill = vi.fn().mockImplementation((pid: number, signal?: number | string) => {
      if (signal === 0 && (pid === 100 || pid === 200)) return true;
      return (originalKill as any)(pid, signal);
    });

    try {
      // PID 100 is verified as cq worker
      const isVerifiedCq = await verifyProcessIdentity(100, mockExec as any);
      expect(isVerifiedCq).toBe(true);

      // PID 200 is an unrelated chrome process
      const isVerifiedChrome = await verifyProcessIdentity(200, mockExec as any);
      expect(isVerifiedChrome).toBe(false);

      const unrelatedWorker = vi.fn().mockResolvedValue({ stdout: 'node unrelated-worker.js\n' });
      expect(await verifyProcessIdentity(300, unrelatedWorker as any)).toBe(false);
    } finally {
      process.kill = originalKill;
    }
  });

  it('uses PowerShell CIM on Windows to verify the full worker command line', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: 'node.exe C:\\Users\\rocio\\codex-queue\\dist\\bin\\cq.js worker\r\n',
    });
    const originalKill = process.kill;
    (process as any).kill = vi.fn().mockImplementation((pid: number, signal?: number | string) => {
      if (signal === 0 && pid === 400) return true;
      return (originalKill as any)(pid, signal);
    });

    try {
      expect(await verifyProcessIdentity(400, mockExec as any, 'win32')).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        'powershell.exe',
        expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command'])
      );
      expect(mockExec.mock.calls[0][1][3]).toContain('ProcessId = 400');
    } finally {
      process.kill = originalKill;
    }
  });

  it('starts daemon, creates state files, and unrefs child', async () => {
    const manager = new DaemonManager({
      verifyIdentityFn: async () => true,
    });
    const mockChild = new EventEmitter() as any;
    mockChild.pid = 4242;
    mockChild.unref = vi.fn();

    const mockSpawn = vi.fn().mockReturnValue(mockChild);

    const state = await manager.start({
      spawnFn: mockSpawn as any,
      binPath: '/usr/local/bin/cq',
    });

    expect(state.pid).toBe(4242);
    expect(mockChild.unref).toHaveBeenCalled();
    expect(fs.existsSync(getWorkerPidPath())).toBe(true);
    expect(fs.existsSync(getWorkerStatePath())).toBe(true);

    const pidContent = fs.readFileSync(getWorkerPidPath(), 'utf8').trim();
    expect(pidContent).toBe('4242');

    const stateContent = JSON.parse(fs.readFileSync(getWorkerStatePath(), 'utf8'));
    expect(stateContent.pid).toBe(4242);
    expect(stateContent.instanceId).toBeDefined();
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      ['/usr/local/bin/cq', 'worker'],
      expect.any(Object)
    );
  });

  it('spawns typescript bin with --import tsx', async () => {
    const manager = new DaemonManager({
      verifyIdentityFn: async () => true,
    });
    const mockChild = new EventEmitter() as any;
    mockChild.pid = 4243;
    mockChild.unref = vi.fn();

    const mockSpawn = vi.fn().mockReturnValue(mockChild);

    await manager.start({
      spawnFn: mockSpawn as any,
      binPath: '/path/to/src/cli/bin.ts',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      ['--import', 'tsx', '/path/to/src/cli/bin.ts', 'worker'],
      expect.any(Object)
    );
  });

  it('rejects starting a second daemon if already running', async () => {
    const manager = new DaemonManager({
      verifyIdentityFn: async () => true,
    });

    const currentPid = process.pid;
    manager.writeState({
      pid: currentPid,
      instanceId: 'test-uuid',
      startedAt: new Date().toISOString(),
      version: '0.3.0',
      cwd: process.cwd(),
      logPath: getWorkerLogPath(),
    });

    await expect(manager.start()).rejects.toThrow(DaemonAlreadyRunningError);
  });

  it('detects and cleans up stale PID when process is dead', async () => {
    const manager = new DaemonManager({
      verifyIdentityFn: async () => true,
    });

    // Write a non-existent PID
    manager.writeState({
      pid: 99999999,
      instanceId: 'stale-uuid',
      startedAt: new Date().toISOString(),
      version: '0.3.0',
      cwd: process.cwd(),
      logPath: getWorkerLogPath(),
    });

    expect(fs.existsSync(getWorkerPidPath())).toBe(true);

    const status = await manager.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.isStale).toBe(true);

    // State files must be cleaned up
    expect(fs.existsSync(getWorkerPidPath())).toBe(false);
    expect(fs.existsSync(getWorkerStatePath())).toBe(false);
  });

  it('gracefully stops verified daemon and cleans up state', async () => {
    const manager = new DaemonManager({
      verifyIdentityFn: async () => true,
    });
    let isAlive = true;

    const originalKill = process.kill;
    (process as any).kill = vi.fn().mockImplementation((pid: number, signal?: number | string) => {
      if (pid === 7777) {
        if (signal === 0) {
          if (!isAlive) {
            const err = new Error('No such process');
            (err as any).code = 'ESRCH';
            throw err;
          }
          return true;
        }
        if (signal === 'SIGTERM') {
          isAlive = false;
          return true;
        }
      }
      return (originalKill as any)(pid, signal);
    });

    try {
      manager.writeState({
        pid: 7777,
        instanceId: 'stop-uuid',
        startedAt: new Date().toISOString(),
        version: '0.3.0',
        cwd: process.cwd(),
        logPath: getWorkerLogPath(),
      });

      const stopResult = await manager.stop(500);
      expect(stopResult.stopped).toBe(true);
      expect(stopResult.wasRunning).toBe(true);
      expect(fs.existsSync(getWorkerPidPath())).toBe(false);
    } finally {
      process.kill = originalKill;
    }
  });

  it('keeps daemon state when a live process cannot be terminated', async () => {
    const manager = new DaemonManager({
      verifyIdentityFn: async () => true,
    });
    const originalKill = process.kill;
    (process as any).kill = vi.fn().mockImplementation((pid: number, signal?: number | string) => {
      if (pid === 8888 && signal === 0) return true;
      if (pid === 8888 && signal === 'SIGTERM') {
        const error = new Error('Operation not permitted');
        (error as any).code = 'EPERM';
        throw error;
      }
      return (originalKill as any)(pid, signal);
    });

    try {
      manager.writeState({
        pid: 8888,
        instanceId: 'permission-uuid',
        startedAt: new Date().toISOString(),
        version: '0.3.0',
        cwd: process.cwd(),
        logPath: getWorkerLogPath(),
      });

      const stopResult = await manager.stop(50);
      expect(stopResult.stopped).toBe(false);
      expect(stopResult.wasRunning).toBe(true);
      expect(fs.existsSync(getWorkerPidPath())).toBe(true);
      expect(fs.existsSync(getWorkerStatePath())).toBe(true);
    } finally {
      process.kill = originalKill;
    }
  });
});
