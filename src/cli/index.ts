import { Command, Option } from 'commander';
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
import { listAliasesCommand, removeAliasCommand, setAliasCommand } from './commands/alias.js';
import { doctorCommand } from './commands/doctor.js';
import { waitCommand } from './commands/wait.js';
import { readConfig } from '../config/aliases.js';
import { resumeCommand } from './commands/resume.js';

function collectImages(value: string, previous: string[] = []): string[] {
  return previous.concat(value);
}

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
    .option('--codex-home <path>', 'Codex home directory/session to use for this task (defaults to CODEX_HOME)')
    .option('--session-id <id>', 'Resume this existing Codex session instead of starting a new one')
    .option('-i, --image <path>', 'Attach an image file; repeat or use comma-separated paths', collectImages, [])
    .option('-p, --priority <level>', 'Task priority: high, normal, or low', 'normal')
    .action(addCommand);

  const aliasCommand = program.command('alias').description('Configure named Codex sessions for queued tasks');
  aliasCommand
    .command('set')
    .description('Create or update a Codex session alias')
    .argument('<name>', 'Alias name used as a --<name> flag')
    .requiredOption('--codex-home <path>', 'Codex home directory for this alias')
    .action(setAliasCommand);
  aliasCommand
    .command('list')
    .description('List configured Codex session aliases')
    .action(listAliasesCommand);
  aliasCommand
    .command('remove')
    .description('Remove a Codex session alias')
    .argument('<name>', 'Alias name to remove')
    .action(removeAliasCommand);

  // Register configured aliases as dynamic boolean flags, e.g. --codexwork.
  // A new program instance picks up aliases added after the previous one was created.
  let configuredAliasNames: string[] = [];
  try {
    configuredAliasNames = Object.keys(readConfig().aliases);
  } catch {
    // Keep diagnostic commands available when the config file is malformed.
  }

  program
    .command('resume')
    .description('Schedule a prompt in an existing Codex session')
    .argument('<session-id>', 'Codex session/thread ID to resume')
    .argument('[prompt]', 'Prompt to send after resuming (defaults to "Continue where you left off.")')
    .option('-C, --repo <path>', 'Repository root directory (defaults to current directory)')
    .option('--codex-home <path>', 'Codex home directory containing the session (defaults to CODEX_HOME)')
    .option('-i, --image <path>', 'Attach an image file; repeat or use comma-separated paths', collectImages, [])
    .option('-p, --priority <level>', 'Task priority: high, normal, or low', 'normal')
    .action(resumeCommand);

  for (const aliasName of configuredAliasNames) {
    for (const commandName of ['add', 'resume']) {
      program.commands
        .find((command) => command.name() === commandName)
        ?.addOption(new Option(`--${aliasName}`, `Use the configured ${aliasName} Codex session`));
    }
  }

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

  program
    .command('doctor')
    .description('Check Codex, storage, session aliases, and daemon health')
    .option('--notify-test', 'Send a test desktop notification')
    .action((options) => doctorCommand({}, options));

  program
    .command('wait')
    .description('Wait for a job to reach a terminal state')
    .argument('<id>', 'Job ID to wait for')
    .option('-i, --interval <ms>', 'Polling interval in milliseconds', '1000')
    .option('-t, --timeout <ms>', 'Stop waiting after this many milliseconds')
    .action(waitCommand);

  return program;
}
