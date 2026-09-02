import fs from 'node:fs';
import path from 'node:path';
import { ensureStorageDirs, getBaseDir } from '../storage/paths.js';

export interface CodexAlias {
  codex_home: string;
}

export interface QueueConfig {
  aliases: Record<string, CodexAlias>;
}

export function getConfigPath(): string {
  return process.env.CQ_CONFIG_PATH || path.join(getBaseDir(), 'config.json');
}

export function validateAliasName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*$/.test(normalized)) {
    throw new Error('Alias names must start with a letter and contain only letters and numbers.');
  }

  const reservedNames = new Set(['help', 'version', 'repo', 'priority', 'codexhome']);
  if (reservedNames.has(normalized)) {
    throw new Error(`Alias name "${normalized}" is reserved.`);
  }

  return normalized;
}

export function readConfig(): QueueConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return { aliases: {} };

  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<QueueConfig> | null;
  const aliases = parsed && parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {};

  const normalizedAliases: Record<string, CodexAlias> = {};
  for (const [name, alias] of Object.entries(aliases)) {
    const aliasName = validateAliasName(name);
    if (!alias || typeof alias !== 'object' || typeof alias.codex_home !== 'string' || !alias.codex_home.trim()) {
      throw new Error(`Invalid configuration for alias "${name}" in ${configPath}.`);
    }
    normalizedAliases[aliasName] = { codex_home: alias.codex_home };
  }

  return { aliases: normalizedAliases };
}

export function writeConfig(config: QueueConfig): void {
  ensureStorageDirs();
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function setAlias(name: string, codexHome: string): CodexAlias {
  const aliasName = validateAliasName(name);
  if (!codexHome.trim()) {
    throw new Error('Codex home cannot be empty.');
  }

  const config = readConfig();
  const alias = { codex_home: codexHome.trim() };
  config.aliases[aliasName] = alias;
  writeConfig(config);
  return alias;
}

export function removeAlias(name: string): boolean {
  const aliasName = validateAliasName(name);
  const config = readConfig();
  if (!config.aliases[aliasName]) return false;

  delete config.aliases[aliasName];
  writeConfig(config);
  return true;
}
