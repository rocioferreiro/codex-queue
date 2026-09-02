import { afterEach, describe, expect, it } from 'vitest';
import type { Job } from '../src/types/job.js';
import { waitForJob } from '../src/cli/commands/wait.js';

function jobWithStatus(status: Job['status']): Job {
  return {
    id: 1,
    prompt: 'test',
    repo_path: '/tmp/project',
    codex_home: null,
    image_paths: [],
    status,
    thread_id: null,
    log_path: null,
    exit_code: null,
    error_message: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    failure_kind: null,
    priority: 0,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('waitForJob', () => {
  it('waits through non-terminal states and returns the final job', async () => {
    const statuses: Job['status'][] = ['pending', 'running', 'completed'];
    const logs: string[] = [];
    let calls = 0;

    const result = await waitForJob(1, { interval: '1' }, {
      getJob: () => jobWithStatus(statuses[Math.min(calls++, statuses.length - 1)]),
      sleep: async () => undefined,
      onLog: (message) => logs.push(message),
    });

    expect(result.status).toBe('completed');
    expect(logs).toEqual(['Job #1: pending', 'Job #1: running', 'Job #1: completed']);
  });

  it('returns failed jobs without polling forever', async () => {
    const result = await waitForJob(1, {}, {
      getJob: () => jobWithStatus('failed'),
      onLog: () => undefined,
    });

    expect(result.status).toBe('failed');
  });

  it('times out when a job never reaches a terminal state', async () => {
    let currentTime = 0;
    await expect(waitForJob(1, { interval: '10', timeout: '20' }, {
      getJob: () => jobWithStatus('running'),
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
      now: () => currentTime,
      onLog: () => undefined,
    })).rejects.toThrow('Timed out waiting for job #1');
  });
});
