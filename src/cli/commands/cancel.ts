import pc from 'picocolors';
import { cancelJob } from '../../db/jobs.js';

export async function cancelCommand(idArg: string): Promise<void> {
  const jobId = parseInt(idArg, 10);
  if (isNaN(jobId)) {
    console.error(pc.red(`Error: Invalid job ID "${idArg}". Must be a number.`));
    process.exitCode = 1;
    return;
  }

  try {
    const result = cancelJob(jobId);
    if (!result.success) {
      console.error(pc.red(`Error: ${result.message}`));
      process.exitCode = 1;
      return;
    }

    console.log(pc.green(`✔ Job #${jobId} cancelled successfully`));
  } catch (err) {
    console.error(pc.red(`Failed to cancel job: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
