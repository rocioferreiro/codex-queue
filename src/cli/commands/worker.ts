import pc from 'picocolors';
import { QueueWorker } from '../../worker/worker.js';

export async function workerCommand(options: { interval?: string; verbose?: boolean }): Promise<void> {
  const pollIntervalMs = options.interval ? parseInt(options.interval, 10) : 1000;
  const verbose = !!options.verbose;

  const worker = new QueueWorker(undefined, {
    pollIntervalMs,
    verbose,
  });

  const shutdown = async (signal: string) => {
    console.log(pc.yellow(`\nReceived ${signal}, shutting down worker gracefully...`));
    await worker.stop(signal);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await worker.start();
  } catch (err) {
    console.error(pc.red(`Worker crashed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
