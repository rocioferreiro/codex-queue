import fs from 'node:fs';
import readline from 'node:readline';
import pc from 'picocolors';
import { getJobById } from '../../db/jobs.js';
import { getJobLogPath, getWorkerLogPath } from '../../storage/paths.js';
import { extractCodexMessage, formatCodexEventSummary } from '../../parser/events.js';
import type { CodexParsedEvent } from '../../types/job.js';

function formatEventLine(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  try {
    const event = JSON.parse(trimmed) as CodexParsedEvent;
    const type = event.type || 'event';

    const message = extractCodexMessage(event);
    if (message) {
      return pc.green(`Codex: ${message}`);
    }

    if (type === 'thread.started' && event.thread_id) {
      return `${pc.cyan('thread started')} (${pc.bold(event.thread_id)})`;
    }
    if (type === 'turn.started') {
      return pc.blue('turn started');
    }
    if (type === 'turn.completed') {
      return pc.green('turn completed');
    }
    if (type === 'turn.failed') {
      const errMsg = (event.error as any)?.message || JSON.stringify(event.error);
      return pc.red(`turn failed: ${errMsg}`);
    }
    if (type === 'error') {
      const msg = typeof event.message === 'string' ? event.message : JSON.stringify(event.message || event.error);
      return pc.red(`error: ${msg}`);
    }

    const summary = formatCodexEventSummary(event);
    if (summary) {
      return summary;
    }

    return pc.gray(type);
  } catch {
    return rawLine;
  }
}

function followFile(filePath: string, onLine: (line: string) => void): void {
  let fileSize = fs.statSync(filePath).size;

  fs.watchFile(filePath, { interval: 250 }, (curr) => {
    if (curr.size > fileSize) {
      const stream = fs.createReadStream(filePath, {
        start: fileSize,
        end: curr.size,
        encoding: 'utf8',
      });

      const rl = readline.createInterface({ input: stream });
      rl.on('line', (line) => {
        onLine(line);
      });

      fileSize = curr.size;
    }
  });

  process.on('SIGINT', () => {
    fs.unwatchFile(filePath);
    process.exit(0);
  });
}

export async function logsCommand(
  targetArg: string,
  options: { raw?: boolean; follow?: boolean }
): Promise<void> {
  const isWorkerLog = targetArg.toLowerCase() === 'worker' || targetArg.toLowerCase() === 'daemon';

  let logFilePath: string;
  let label: string;

  if (isWorkerLog) {
    logFilePath = getWorkerLogPath();
    label = 'Worker';
  } else {
    const jobId = parseInt(targetArg, 10);
    if (isNaN(jobId)) {
      console.error(pc.red(`Error: Invalid target "${targetArg}". Must be a job ID (number) or "worker".`));
      process.exitCode = 2;
      return;
    }

    const job = getJobById(jobId);
    logFilePath = job?.log_path || getJobLogPath(jobId);
    label = `Job #${jobId}`;
  }

  if (!fs.existsSync(logFilePath)) {
    console.log(pc.gray(`No log file found for ${label} at: ${logFilePath}`));
    return;
  }

  // Print existing file content
  const content = fs.readFileSync(logFilePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);

  if (lines.length === 0) {
    console.log(pc.gray(`Log file for ${label} is currently empty.`));
  } else {
    for (const line of lines) {
      if (options.raw || isWorkerLog) {
        console.log(line);
      } else {
        const formatted = formatEventLine(line);
        if (formatted) {
          console.log(formatted);
        }
      }
    }
  }

  // Handle follow mode
  if (options.follow) {
    console.log(pc.dim(`\n--- Following ${label} logs (Ctrl+C to exit) ---`));
    followFile(logFilePath, (line) => {
      if (options.raw || isWorkerLog) {
        console.log(line);
      } else {
        const formatted = formatEventLine(line);
        if (formatted) {
          console.log(formatted);
        }
      }
    });
  }
}
