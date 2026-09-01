import pc from 'picocolors';
import { getJobById } from '../../db/jobs.js';
import { JobExecutor } from '../../execution/job-executor.js';
import { formatCodexEventSummary } from '../../parser/events.js';
import type { CodexParsedEvent } from '../../types/job.js';

function formatDate(isoString: string | null): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export async function runCommand(idArg: string, options: { verbose?: boolean }): Promise<void> {
  const jobId = parseInt(idArg, 10);
  if (isNaN(jobId)) {
    console.error(pc.red(`Error: Invalid job ID "${idArg}". Must be a number.`));
    process.exitCode = 1;
    return;
  }

  const initialJob = getJobById(jobId);
  if (!initialJob) {
    console.error(pc.red(`Error: Job #${jobId} not found.`));
    process.exitCode = 1;
    return;
  }

  if (initialJob.status === 'completed') {
    console.log(pc.yellow(`Notice: Job #${jobId} was already completed. Running it again...`));
  }

  console.log(pc.cyan(`▶ Starting Job #${initialJob.id}`));
  console.log(`  ${pc.bold('Repo:')}   ${initialJob.repo_path}`);
  console.log(`  ${pc.bold('Prompt:')} ${initialJob.prompt}`);
  console.log(pc.gray('─'.repeat(60)));

  const executor = new JobExecutor();

  try {
    const { job: finalJob, runnerResult } = await executor.executeJob(jobId, {
      verbose: options.verbose,
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
    const durationSec = (runnerResult.durationMs / 1000).toFixed(2);

    if (finalJob.status === 'completed') {
      console.log(pc.green(`✔ Job #${finalJob.id} completed successfully in ${durationSec}s`));
      if (finalJob.thread_id) {
        console.log(`  ${pc.bold('Thread ID:')} ${finalJob.thread_id}`);
      }
      console.log(`  ${pc.bold('Log File:')}  ${finalJob.log_path}`);
    } else if (finalJob.status === 'waiting_limit') {
      console.log(pc.yellow(`Codex usage limit reached.`));
      if (finalJob.next_attempt_at) {
        console.log(
          pc.yellow(
            `Job #${finalJob.id} will be available for retry after ${formatDate(finalJob.next_attempt_at)}.`
          )
        );
      } else {
        console.log(pc.yellow(`Job #${finalJob.id} is queued in waiting_limit for backoff retry.`));
      }
      if (finalJob.thread_id) {
        console.log(`  ${pc.bold('Thread ID:')} ${finalJob.thread_id}`);
      }
      console.log(`  ${pc.bold('Log File:')}  ${finalJob.log_path}`);
      process.exitCode = 1;
    } else if (finalJob.status === 'interrupted') {
      console.log(pc.yellow(`Job #${finalJob.id} was interrupted.`));
      if (finalJob.last_error) {
        console.log(pc.yellow(`  Reason: ${finalJob.last_error}`));
      }
      process.exitCode = 1;
    } else {
      console.error(
        pc.red(`✖ Job #${finalJob.id} failed with exit code ${runnerResult.exitCode} (${durationSec}s)`)
      );
      if (finalJob.last_error || runnerResult.errorMessage) {
        console.error(pc.red(`  Error: ${finalJob.last_error || runnerResult.errorMessage}`));
      }
      console.log(`  ${pc.bold('Log File:')}  ${finalJob.log_path}`);
      process.exitCode = runnerResult.exitCode || 1;
    }
  } catch (err) {
    console.error(pc.red(`✖ Execution error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
