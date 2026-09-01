import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { runCommand } from './commands/run.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('cq')
    .description('Local task queue for Codex CLI')
    .version('0.1.0');

  program
    .command('add')
    .description('Add a new Codex task to the queue')
    .argument('<prompt>', 'Prompt or instruction for Codex')
    .option('-C, --repo <path>', 'Repository root directory (defaults to current directory)')
    .action(addCommand);

  program
    .command('list')
    .description('List queued and executed Codex jobs')
    .option('-s, --status <status>', 'Filter by status (pending, running, completed, failed)')
    .option('-l, --limit <number>', 'Limit the number of results')
    .action(listCommand);

  program
    .command('run')
    .description('Execute a specific queued job with Codex CLI')
    .argument('<id>', 'Job ID to execute')
    .option('-v, --verbose', 'Print verbose event stream during execution')
    .action(runCommand);

  return program;
}
