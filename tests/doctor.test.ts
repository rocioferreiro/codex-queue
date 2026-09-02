import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDatabase } from '../src/db/client.js';
import { setAlias } from '../src/config/aliases.js';
import { doctorCommand } from '../src/cli/commands/doctor.js';

describe('Doctor Command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-doctor-test-'));
    process.env.CQ_HOME = tempDir;
    process.env.CQ_DB_PATH = path.join(tempDir, 'test.db');
    process.env.CQ_LOGS_DIR = path.join(tempDir, 'logs');
    delete process.env.CQ_CONFIG_PATH;
    delete process.env.CODEX_HOME;
    process.exitCode = undefined;

    fs.mkdirSync(process.env.CQ_LOGS_DIR, { recursive: true });
    const db = initDatabase(process.env.CQ_DB_PATH);
    db.close();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('reports a healthy Codex setup and configured alias', async () => {
    const workHome = path.join(tempDir, 'codex-work');
    fs.mkdirSync(workHome);
    setAlias('codexwork', workHome);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      signal: null,
      error: undefined,
      stdout: 'codex 0.3.0\n',
      stderr: '',
    });

    await doctorCommand({
      spawnSync: spawnSync as any,
      getDaemonStatus: async () => ({ isRunning: false, state: null, isStale: false }),
    });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Codex CLI: codex 0.3.0');
    expect(output).toContain(`--codexwork: ${workHome}`);
    expect(output).toContain('All checks passed.');
    expect(spawnSync).toHaveBeenCalledWith('codex', ['--version'], expect.objectContaining({ shell: false }));
    expect(process.exitCode).toBeUndefined();
  });

  it('returns a failure when a configured alias home is missing', async () => {
    const missingHome = path.join(tempDir, 'missing-session');
    setAlias('codexsti', missingHome);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await doctorCommand({
      spawnSync: vi.fn().mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        stdout: 'codex 0.3.0\n',
        stderr: '',
      }) as any,
      getDaemonStatus: async () => ({ isRunning: false, state: null, isStale: false }),
    });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain(`--codexsti: not found: ${missingHome}`);
    expect(output).toContain('Doctor found 1 problem(s).');
    expect(process.exitCode).toBe(1);
  });
});
