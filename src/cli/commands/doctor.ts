import fs from 'node:fs';
import Database from 'better-sqlite3';
import { spawnSync as defaultSpawnSync } from 'node:child_process';
import pc from 'picocolors';
import { DaemonManager } from '../../daemon/manager.js';
import type { DaemonStatusResult } from '../../daemon/types.js';
import { getDbPath, getBaseDir, getLogsDir } from '../../storage/paths.js';
import { readConfig, resolveCodexHome, getConfigPath } from '../../config/aliases.js';
import { notificationsEnabled } from '../../notifications/index.js';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface DoctorCheck {
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorDependencies {
  spawnSync?: typeof defaultSpawnSync;
  getDaemonStatus?: () => Promise<DaemonStatusResult>;
  platform?: NodeJS.Platform;
}

export interface DoctorOptions {
  notifyTest?: boolean;
}

function checkDirectory(label: string, directoryPath: string, missingStatus: CheckStatus = 'warn'): DoctorCheck {
  if (!fs.existsSync(directoryPath)) {
    return { label, status: missingStatus, detail: `not found: ${directoryPath}` };
  }

  try {
    if (!fs.statSync(directoryPath).isDirectory()) {
      return { label, status: 'fail', detail: `not a directory: ${directoryPath}` };
    }
    fs.accessSync(directoryPath, fs.constants.R_OK | fs.constants.W_OK);
    return { label, status: 'ok', detail: directoryPath };
  } catch (err) {
    return {
      label,
      status: 'fail',
      detail: `not readable/writable: ${directoryPath} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function checkCodex(codexBin: string, spawnSync: typeof defaultSpawnSync): DoctorCheck {
  try {
    const result = spawnSync(codexBin, ['--version'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
    });

    if (result.error) {
      return { label: 'Codex CLI', status: 'fail', detail: `${codexBin}: ${result.error.message}` };
    }
    if (result.status !== 0) {
      const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      return {
        label: 'Codex CLI',
        status: 'fail',
        detail: `${codexBin} exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`,
      };
    }

    const version = typeof result.stdout === 'string' ? result.stdout.trim().split(/\r?\n/, 1)[0] : '';
    return { label: 'Codex CLI', status: 'ok', detail: version || codexBin };
  } catch (err) {
    return { label: 'Codex CLI', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
  }
}

function checkDatabase(): DoctorCheck {
  const dbPath = getDbPath();
  if (dbPath === ':memory:') {
    return { label: 'SQLite', status: 'ok', detail: 'in-memory database' };
  }
  if (!fs.existsSync(dbPath)) {
    return { label: 'SQLite', status: 'warn', detail: `not initialized yet: ${dbPath}` };
  }

  let db: Database.Database | null = null;
  try {
    if (!fs.statSync(dbPath).isFile()) {
      return { label: 'SQLite', status: 'fail', detail: `not a file: ${dbPath}` };
    }
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const result = db.pragma('quick_check', { simple: true });
    if (result !== 'ok') {
      return { label: 'SQLite', status: 'fail', detail: `integrity check failed: ${String(result)}` };
    }
    return { label: 'SQLite', status: 'ok', detail: dbPath };
  } catch (err) {
    return { label: 'SQLite', status: 'fail', detail: `${dbPath}: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    db?.close();
  }
}

function checkConfiguredHomes(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const currentHome = process.env.CODEX_HOME?.trim();

  if (currentHome) {
    checks.push(checkDirectory('CODEX_HOME', resolveCodexHome(currentHome)!, 'fail'));
  } else {
    checks.push({ label: 'CODEX_HOME', status: 'ok', detail: 'not set; Codex default will be used' });
  }

  try {
    const aliases = Object.entries(readConfig().aliases);
    if (aliases.length === 0) {
      checks.push({ label: 'Session aliases', status: 'ok', detail: `none configured (${getConfigPath()})` });
      return checks;
    }

    checks.push({ label: 'Session aliases', status: 'ok', detail: `${aliases.length} configured (${getConfigPath()})` });
    for (const [name, alias] of aliases.sort(([a], [b]) => a.localeCompare(b))) {
      checks.push(checkDirectory(`  --${name}`, resolveCodexHome(alias.codex_home)!, 'fail'));
    }
  } catch (err) {
    checks.push({
      label: 'Session aliases',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return checks;
}

function checkNotifications(
  spawnSync: typeof defaultSpawnSync,
  platform: NodeJS.Platform,
  notifyTest: boolean
): DoctorCheck {
  if (!notificationsEnabled()) {
    return { label: 'Notifications', status: 'ok', detail: 'disabled by CQ_NOTIFY' };
  }

  let command: string;
  let args: string[];
  if (platform === 'darwin') {
    command = 'osascript';
    args = notifyTest
      ? ['-e', 'display notification "codex-queue doctor test" with title "codex-queue"']
      : ['-e', 'return 0'];
  } else if (platform === 'linux') {
    command = 'notify-send';
    args = notifyTest ? ['codex-queue', 'codex-queue doctor test'] : ['--version'];
  } else {
    return { label: 'Notifications', status: 'warn', detail: `unsupported platform: ${platform}` };
  }

  try {
    const result = spawnSync(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.error) {
      return { label: 'Notifications', status: 'fail', detail: `${command}: ${result.error.message}` };
    }
    if (result.status !== 0) {
      const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      return {
        label: 'Notifications',
        status: 'fail',
        detail: `${command} exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`,
      };
    }
    return {
      label: 'Notifications',
      status: 'ok',
      detail: notifyTest ? `${command} accepted a test notification` : `${command} is available`,
    };
  } catch (err) {
    return { label: 'Notifications', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkDaemon(getDaemonStatus: () => Promise<DaemonStatusResult>): Promise<DoctorCheck> {
  try {
    const status = await getDaemonStatus();
    if (status.isStale) {
      return { label: 'Daemon', status: 'warn', detail: 'stale runtime state was cleaned up' };
    }
    if (status.isRunning && status.state) {
      return { label: 'Daemon', status: 'ok', detail: `running (PID ${status.state.pid})` };
    }
    return { label: 'Daemon', status: 'ok', detail: 'stopped' };
  } catch (err) {
    return { label: 'Daemon', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
  }
}

function printCheck(check: DoctorCheck): void {
  const icon = check.status === 'ok' ? pc.green('✔') : check.status === 'warn' ? pc.yellow('!') : pc.red('✖');
  console.log(`${icon} ${pc.bold(`${check.label}:`)} ${check.detail}`);
}

export async function doctorCommand(
  dependencies: DoctorDependencies = {},
  options: DoctorOptions = {}
): Promise<void> {
  const codexBin = process.env.CQ_CODEX_BIN || 'codex';
  const spawnSync = dependencies.spawnSync || defaultSpawnSync;
  const getDaemonStatus = dependencies.getDaemonStatus || (() => new DaemonManager().getStatus());

  console.log(pc.bold(pc.cyan('codex-queue doctor\n')));

  const checks: DoctorCheck[] = [
    checkCodex(codexBin, spawnSync),
    checkDirectory('Queue home', getBaseDir()),
    checkDirectory('Logs directory', getLogsDir()),
    checkDatabase(),
    ...checkConfiguredHomes(),
    checkNotifications(spawnSync, dependencies.platform || process.platform, options.notifyTest || false),
    await checkDaemon(getDaemonStatus),
  ];

  for (const check of checks) printCheck(check);

  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;
  if (failures > 0) {
    console.log(pc.red(`\nDoctor found ${failures} problem(s).`));
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(pc.yellow(`\nDoctor found no blocking problems (${warnings} warning(s)).`));
  } else {
    console.log(pc.green('\nAll checks passed.'));
  }
}
