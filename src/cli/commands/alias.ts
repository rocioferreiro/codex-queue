import pc from 'picocolors';
import { readConfig, removeAlias, setAlias, getConfigPath, validateAliasName } from '../../config/aliases.js';

export async function setAliasCommand(
  name: string,
  options: { codexHome: string }
): Promise<void> {
  try {
    const aliasName = validateAliasName(name);
    const alias = setAlias(aliasName, options.codexHome);
    console.log(pc.green(`✔ Alias "${aliasName}" configured`));
    console.log(`  ${pc.bold('Codex home:')} ${alias.codex_home}`);
    console.log(`  ${pc.bold('Config:')}     ${getConfigPath()}`);
    console.log(`\nUse it with: ${pc.cyan(`cq add "<prompt>" --${aliasName}`)}`);
  } catch (err) {
    console.error(pc.red(`Failed to configure alias: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}

export async function listAliasesCommand(): Promise<void> {
  try {
    const config = readConfig();
    const entries = Object.entries(config.aliases);

    if (entries.length === 0) {
      console.log(pc.gray(`No Codex aliases configured. Config: ${getConfigPath()}`));
      return;
    }

    console.log(pc.bold('Codex aliases'));
    for (const [name, alias] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${pc.cyan(`--${name}`.padEnd(16))} ${alias.codex_home}`);
    }
    console.log(pc.gray(`\nConfig: ${getConfigPath()}`));
  } catch (err) {
    console.error(pc.red(`Failed to read aliases: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}

export async function removeAliasCommand(name: string): Promise<void> {
  try {
    const aliasName = validateAliasName(name);
    if (!removeAlias(aliasName)) {
      console.error(pc.red(`Alias "${aliasName}" is not configured.`));
      process.exitCode = 1;
      return;
    }
    console.log(pc.green(`✔ Alias "${aliasName}" removed`));
  } catch (err) {
    console.error(pc.red(`Failed to remove alias: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
