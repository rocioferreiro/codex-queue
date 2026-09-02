import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { notifyJob } from '../src/notifications/index.js';

function fakeProcess() {
  const process = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
  process.unref = vi.fn();
  return process;
}

describe('desktop notifications', () => {
  it('uses osascript on macOS without exposing the prompt', () => {
    const child = fakeProcess();
    const spawnFn = vi.fn(() => child) as any;

    expect(notifyJob(7, 'completed', undefined, { platform: 'darwin', spawnFn })).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'display notification "completed" with title "codex-queue · Job #7"'],
      { detached: true, stdio: 'ignore' }
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it('uses notify-send on Linux and supports details', () => {
    const child = fakeProcess();
    const spawnFn = vi.fn(() => child) as any;

    expect(notifyJob(3, 'waiting_limit', 'next attempt at 10:00', { platform: 'linux', spawnFn })).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(
      'notify-send',
      ['codex-queue · Job #3', 'waiting for Codex usage reset: next attempt at 10:00'],
      { detached: true, stdio: 'ignore' }
    );
  });

  it('does not fail when the platform notifier is unavailable', () => {
    const spawnFn = vi.fn(() => {
      throw new Error('not installed');
    }) as any;

    expect(notifyJob(1, 'failed', 'Codex failed', { platform: 'linux', spawnFn })).toBe(false);
  });
});
