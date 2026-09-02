import pc from 'picocolors';
import { createJob } from '../../db/jobs.js';
import { CONTINUE_WHERE_LEFT_OFF_PROMPT } from '../../types/job.js';
import { readConfig } from '../../config/aliases.js';

export async function resumeCommand(
  sessionIdText: string,
  promptText: string | undefined,
  options: { repo?: string; codexHome?: string; image?: string[]; priority?: string; [key: string]: unknown }
): Promise<void> {
  const sessionId = sessionIdText?.trim();
  if (!sessionId) {
    console.error(pc.red('Error: Session ID cannot be empty.'));
    process.exitCode = 1;
    return;
  }

  const prompt = promptText?.trim() || CONTINUE_WHERE_LEFT_OFF_PROMPT;

  try {
    const aliases = readConfig().aliases;
    const selectedAliases = Object.keys(aliases).filter((aliasName) => options[aliasName] === true);
    if (selectedAliases.length > 1) {
      throw new Error(`Choose only one Codex alias: ${selectedAliases.map((name) => `--${name}`).join(', ')}.`);
    }
    if (options.codexHome && selectedAliases.length > 0) {
      throw new Error('Use either --codex-home or a configured Codex alias, not both.');
    }

    const selectedAlias = selectedAliases[0];
    const codexHome = selectedAlias ? aliases[selectedAlias].codex_home : options.codexHome;
    const job = createJob({
      prompt,
      repo_path: options.repo || process.cwd(),
      codex_home: codexHome,
      session_id: sessionId,
      image_paths: options.image,
      priority: options.priority || 'normal',
    });

    console.log(pc.green(`✔ Resume job #${job.id} created successfully`));
    console.log(`  ${pc.bold('Status:')}     ${pc.yellow(job.status)}`);
    console.log(`  ${pc.bold('Session ID:')} ${sessionId}`);
    console.log(`  ${pc.bold('Repo:')}       ${job.repo_path}`);
    console.log(`  ${pc.bold('Codex home:')} ${job.codex_home || 'default (inherited)'}`);
    if (selectedAlias) {
      console.log(`  ${pc.bold('Alias:')}       --${selectedAlias}`);
    }
    console.log(`  ${pc.bold('Prompt:')}     ${job.prompt}`);
    console.log(`\nRun this job with: ${pc.cyan(`cq run ${job.id}`)} or start the worker with: ${pc.cyan('cq worker')}`);
  } catch (err) {
    console.error(pc.red(`Failed to schedule session resume: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
