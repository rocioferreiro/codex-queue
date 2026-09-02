import pc from 'picocolors';
import { createJob } from '../../db/jobs.js';
import type { PriorityLevel } from '../../types/job.js';
import { readConfig } from '../../config/aliases.js';

export async function addCommand(
  promptText: string,
  options: { repo?: string; codexHome?: string; sessionId?: string; image?: string[]; priority?: string; [key: string]: unknown }
): Promise<void> {
  const prompt = promptText?.trim();
  if (!prompt) {
    console.error(pc.red('Error: Prompt cannot be empty.'));
    process.exitCode = 1;
    return;
  }

  if (options.sessionId !== undefined && !options.sessionId.trim()) {
    console.error(pc.red('Error: Session ID cannot be empty.'));
    process.exitCode = 1;
    return;
  }

  const repoPath = options.repo ? options.repo : process.cwd();
  const priority = options.priority || 'normal';

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
      repo_path: repoPath,
      codex_home: codexHome,
      session_id: options.sessionId?.trim(),
      image_paths: options.image,
      priority,
    });
    console.log(pc.green(`✔ Job #${job.id} created successfully`));
    console.log(`  ${pc.bold('Status:')}    ${pc.yellow(job.status)}`);
    console.log(`  ${pc.bold('Priority:')}  ${job.priority > 0 ? pc.magenta('high') : job.priority < 0 ? pc.gray('low') : 'normal'}`);
    console.log(`  ${pc.bold('Repo:')}      ${job.repo_path}`);
    console.log(`  ${pc.bold('Codex home:')} ${job.codex_home || 'default (inherited)'}`);
    if (job.thread_id) {
      console.log(`  ${pc.bold('Session ID:')} ${job.thread_id}`);
    }
    if (selectedAlias) {
      console.log(`  ${pc.bold('Alias:')}      --${selectedAlias}`);
    }
    if (job.image_paths.length > 0) {
      console.log(`  ${pc.bold('Images:')}     ${job.image_paths.length}`);
    }
    console.log(`  ${pc.bold('Prompt:')}    ${job.prompt.length > 80 ? job.prompt.slice(0, 77) + '...' : job.prompt}`);
    console.log(`\nRun this job with: ${pc.cyan(`cq run ${job.id}`)} or start the worker with: ${pc.cyan('cq worker')}`);
  } catch (err) {
    console.error(pc.red(`Failed to add job: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
