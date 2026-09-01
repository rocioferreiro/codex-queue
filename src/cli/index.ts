import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { runCommand } from './commands/run.js';
import { cancelCommand } from './commands/cancel.js';
import { retryCommand } from './commands/retry.js';
import { workerCommand } from './commands/worker.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('cq')
    .description('Local availability-aware task queue for Codex CLI')
    .version('0.2.0');

  program
    .command('add')
    .description('Add a new Codex task to the queue')
    .argument('<prompt>', 'Prompt or instruction for Codex')
    .option('-C, --repo <path>', 'Repository root directory (defaults to current directory)')
    .option('-p, --priority <level>', 'Task priority: high, normal, or low', 'normal')
    .action(addCommand);

  program
    .command('list')
    .description('List queued and executed Codex jobs')
    .option(
      '-s, --status <status>',
      'Filter by status (pending, running, waiting_limit, interrupted, completed, failed, cancelled)'
    )
    .option('-l, --limit <number>', 'Limit the number of results')
    .action(listCommand);

  program
    .command('run')
    .description('Execute a specific queued job immediately with Codex CLI')
    .argument('<id>', 'Job ID to execute')
    .option('-v, --verbose', 'Print verbose event stream during execution')
    .action(runCommand);

  program
    .command('cancel')
    .description('Cancel a pending, waiting, or interrupted job')
    .argument('<id>', 'Job ID to cancel')
    .action(cancelCommand);

  program
    .command('retry')
    .description('Return an interrupted or failed job to pending state')
    .argument('<id>', 'Job ID to retry')
    .action(retryCommand);

  program
    .command('worker')
    .description('Start the foreground queue worker to automatically process tasks as capacity allows')
    .option('-i, --interval <ms>', 'Polling interval in milliseconds', '1000')
    .option('-v, --verbose', 'Print verbose usage limit and scheduling details')
    .action(workerCommand);

  return program;
}
