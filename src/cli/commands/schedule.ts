import pc from 'picocolors';
import { scheduleJob } from '../../db/jobs.js';
import { parseScheduledTime } from '../../scheduling.js';

export async function scheduleCommand(idArg: string, options: { at?: string }): Promise<void> {
  const jobId = parseInt(idArg, 10);
  if (isNaN(jobId)) {
    console.error(pc.red(`Error: Invalid job ID "${idArg}". Must be a number.`));
    process.exitCode = 1;
    return;
  }

  if (!options.at) {
    console.error(pc.red('Error: --at is required.'));
    process.exitCode = 1;
    return;
  }

  try {
    const nextAttemptAt = parseScheduledTime(options.at);
    const result = scheduleJob(jobId, nextAttemptAt);
    if (!result.success) {
      console.error(pc.red(`Error: ${result.message}`));
      process.exitCode = 1;
      return;
    }

    console.log(pc.green(`✔ Job #${jobId} scheduled successfully`));
    console.log(`  ${pc.bold('Next attempt:')} ${result.job?.next_attempt_at}`);
  } catch (err) {
    console.error(pc.red(`Failed to schedule job: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
