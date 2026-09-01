import pc from 'picocolors';
import { getJobById } from '../../db/jobs.js';
import { CodexRunner } from '../../runner/codex-runner.js';
import { formatCodexEventSummary } from '../../parser/events.js';
import type { CodexParsedEvent } from '../../types/job.js';

export async function runCommand(idArg: string, options: { verbose?: boolean }): Promise<void> {
  const jobId = parseInt(idArg, 10);
  if (isNaN(jobId)) {
    console.error(pc.red(`Error: Invalid job ID "${idArg}". Must be a number.`));
    process.exitCode = 1;
    return;
  }

  const job = getJobById(jobId);
  if (!job) {
    console.error(pc.red(`Error: Job #${jobId} not found.`));
    process.exitCode = 1;
    return;
  }

  if (job.status === 'completed') {
    console.log(pc.yellow(`Notice: Job #${jobId} was already completed. Running it again...`));
  }

  console.log(pc.cyan(`▶ Starting Job #${job.id}`));
  console.log(`  ${pc.bold('Repo:')}   ${job.repo_path}`);
  console.log(`  ${pc.bold('Prompt:')} ${job.prompt}`);
  console.log(pc.gray('─'.repeat(60)));

  const runner = new CodexRunner();

  try {
    const result = await runner.run(job, {
      onThreadId: (threadId) => {
        console.log(pc.green(`✔ Captured Codex thread_id: ${pc.bold(threadId)}`));
      },
      onEvent: (event) => {
        if (options.verbose) {
          const summary = formatCodexEventSummary(event as CodexParsedEvent);
          if (summary) {
            console.log(pc.gray(`  [event] ${summary}`));
          }
        }
      },
      onStderr: (chunk) => {
        process.stderr.write(pc.dim(chunk));
      },
    });

    console.log(pc.gray('─'.repeat(60)));
    const durationSec = (result.durationMs / 1000).toFixed(2);

    if (result.exitCode === 0) {
      console.log(pc.green(`✔ Job #${job.id} completed successfully in ${durationSec}s`));
      if (result.threadId) {
        console.log(`  ${pc.bold('Thread ID:')} ${result.threadId}`);
      }
      console.log(`  ${pc.bold('Log File:')}  ${result.logPath}`);
    } else {
      console.error(pc.red(`✖ Job #${job.id} failed with exit code ${result.exitCode} (${durationSec}s)`));
      if (result.errorMessage) {
        console.error(pc.red(`  Error: ${result.errorMessage}`));
      }
      console.log(`  ${pc.bold('Log File:')}  ${result.logPath}`);
      process.exitCode = result.exitCode || 1;
    }
  } catch (err) {
    console.error(pc.red(`✖ Execution error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
