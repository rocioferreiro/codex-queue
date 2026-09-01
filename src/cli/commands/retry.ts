import pc from 'picocolors';
import { retryJob } from '../../db/jobs.js';

export async function retryCommand(idArg: string): Promise<void> {
  const jobId = parseInt(idArg, 10);
  if (isNaN(jobId)) {
    console.error(pc.red(`Error: Invalid job ID "${idArg}". Must be a number.`));
    process.exitCode = 1;
    return;
  }

  try {
    const result = retryJob(jobId);
    if (!result.success) {
      console.error(pc.red(`Error: ${result.message}`));
      process.exitCode = 1;
      return;
    }

    console.log(pc.green(`✔ Job #${jobId} reset to pending (attempts preserved: ${result.job?.attempts || 0})`));
    console.log(`\nRun this job with: ${pc.cyan(`cq run ${jobId}`)} or let the worker run it: ${pc.cyan('cq worker')}`);
  } catch (err) {
    console.error(pc.red(`Failed to retry job: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
