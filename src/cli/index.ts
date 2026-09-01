import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { runCommand } from './commands/run.js';
import { cancelCommand } from './commands/cancel.js';
import { retryCommand } from './commands/retry.js';
import { workerCommand } from './commands/worker.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { restartCommand } from './commands/restart.js';
import { statusCommand } from './commands/status.js';
import { showCommand } from './commands/show.js';
import { logsCommand } from './commands/logs.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('cq')
    .description('Local availability-aware task queue for Codex CLI')
    .version('0.3.0');

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
    .command('show')
    .description('Show full details and metadata for a specific job')
    .argument('<id>', 'Job ID to inspect')
    .action(showCommand);

  program
    .command('logs')
    .description('View or follow events from a job or the background worker log')
    .argument('<target>', 'Job ID (e.g. 1) or "worker"')
    .option('-r, --raw', 'Output raw unformatted JSONL/text logs')
    .option('-f, --follow', 'Follow/tail new incoming log lines in real time')
    .action(logsCommand);

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

  program
    .command('start')
    .description('Start the queue worker daemon in the background')
    .action(startCommand);

  program
    .command('stop')
    .description('Stop the background queue worker daemon gracefully')
    .action(stopCommand);

  program
    .command('restart')
    .description('Restart the background queue worker daemon')
    .action(restartCommand);

  program
    .command('status')
    .description('Show the status of the background worker daemon and queue metrics')
    .action(statusCommand);

  return program;
}
