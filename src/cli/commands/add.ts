import pc from 'picocolors';
import { createJob } from '../../db/jobs.js';
import type { PriorityLevel } from '../../types/job.js';

export async function addCommand(
  promptText: string,
  options: { repo?: string; priority?: string }
): Promise<void> {
  const prompt = promptText?.trim();
  if (!prompt) {
    console.error(pc.red('Error: Prompt cannot be empty.'));
    process.exitCode = 1;
    return;
  }

  const repoPath = options.repo ? options.repo : process.cwd();
  const priority = options.priority || 'normal';

  try {
    const job = createJob({ prompt, repo_path: repoPath, priority });
    console.log(pc.green(`✔ Job #${job.id} created successfully`));
    console.log(`  ${pc.bold('Status:')}    ${pc.yellow(job.status)}`);
    console.log(`  ${pc.bold('Priority:')}  ${job.priority > 0 ? pc.magenta('high') : job.priority < 0 ? pc.gray('low') : 'normal'}`);
    console.log(`  ${pc.bold('Repo:')}      ${job.repo_path}`);
    console.log(`  ${pc.bold('Prompt:')}    ${job.prompt.length > 80 ? job.prompt.slice(0, 77) + '...' : job.prompt}`);
    console.log(`\nRun this job with: ${pc.cyan(`cq run ${job.id}`)} or start the worker with: ${pc.cyan('cq worker')}`);
  } catch (err) {
    console.error(pc.red(`Failed to add job: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
