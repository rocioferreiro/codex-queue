# codex-queue (`cq`)

[![npm version](https://img.shields.io/npm/v/codex-queue.svg)](https://www.npmjs.com/package/codex-queue)
[![npm downloads](https://img.shields.io/npm/dm/codex-queue.svg)](https://www.npmjs.com/package/codex-queue)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

Ran out of Codex usage limits but still have prompts to run?

`codex-queue` is a persistent local queue for Codex CLI prompts. Add work from
any repository, close your terminal, and let the background worker execute jobs
sequentially. When Codex reports a usage limit, `codex-queue` waits for the
detected reset time and retries the job automatically.

It does not bypass provider limits. It schedules work for when Codex is
available again.

> **In one sentence:** a local, multi-job, usage-limit-aware queue for Codex CLI.

> **Project status:** early development (`0.x`). The CLI and storage format may
> change between releases.

## What it does

- Queues independent Codex tasks from any repository.
- Persists jobs locally so they survive closing the terminal.
- Detects usage-limit responses and retries after the reset window.
- Runs one job at a time with priorities, logs, and inspectable states.
- Resumes existing Codex sessions and supports multiple Codex homes.
- Sends best-effort desktop notifications when jobs change state.

Everything managed by `codex-queue` stays on your machine: the SQLite database,
worker state, and job logs are stored under `~/.codex-queue` by default. The
Codex CLI itself may still communicate with its configured service.

## Is this for you?

Use `codex-queue` if you:

- have independent Codex tasks waiting to be run;
- work across multiple repositories;
- want jobs to survive closing the terminal;
- regularly hit Codex usage limits;
- want automatic retries, logs, and notifications.

Use the built-in `codex queue` command if you only need to send a message to one
existing Codex session. See the [comparison](https://github.com/rocioferreiro/codex-queue/blob/main/docs/codex-cli-queue-vs-codex-queue.md)
for the difference.

## Prerequisites

- Node.js 20 or newer.
- Codex CLI installed, authenticated, and available as `codex` on `PATH`.
- A repository that Codex can access with its configured sandbox and permissions.

The queue and worker are supported on macOS and Linux. Windows support is
planned but not currently documented or tested.

## Quick start

### Install

For normal use, install the latest published release from npm:

```bash
npm install --global codex-queue
cq --help
```

The package exposes both `cq` and `codex-queue` commands.

### Start the worker and add tasks

Start the detached worker once:

```bash
cq start
```

Queue tasks from any directory. The current directory is used as the
repository unless `--repo` is supplied:

```bash
cd ~/projects/project-a
cq add "Implement user authentication with JWT"

cd ~/projects/project-b
cq add "Review the production memory leak" --priority high
```

### Inspect progress

```bash
cq status
cq list
cq show 1
cq logs 1
```

Stop the worker when you no longer need it:

```bash
cq stop
```

## What happens when Codex hits a usage limit?

When Codex returns a usage-limit response, the job enters `waiting_limit`. The
worker parses the reset time when one is available, waits until that time with
a safety buffer, and retries the job. If no usable reset time is present, the
retry policy uses its backoff instead.

```bash
cq list --status waiting_limit
cq show <job-id>
cq logs <job-id>
```

This does not bypass, extend, or redeem a provider limit. It only stores the
work locally and runs it when the Codex CLI becomes available again.

See the detailed guide: [Queue Codex prompts after a usage limit](https://github.com/rocioferreiro/codex-queue/blob/main/docs/queue-after-codex-usage-limit.md).

## Common workflows

### Run Codex tasks overnight

`cq start` launches a detached worker that continues after the terminal is
closed. Queue several tasks, then inspect them later with `cq status`, `cq list`,
and `cq logs <id>`.

See [Run Codex tasks overnight](https://github.com/rocioferreiro/codex-queue/blob/main/docs/run-codex-tasks-overnight.md).

### Resume an existing session

```bash
cq add "Review the changes" --session-id <session-id>
cq resume <session-id>
cq resume <session-id> "Run the tests and fix any failures"
```

The `resume` command defaults to `Continue where you left off.`. When a job
hits a usage limit, its scheduled retry resumes the captured session with the
same continuation prompt instead of starting a new session.

### Use different Codex sessions

```bash
cq add "Use the work session" --codex-home ~/.codex-work
cq alias set codexwork --codex-home ~/.codex-work
cq add "Use the work session" --codexwork
```

Aliases are optional. See [Configuration](https://github.com/rocioferreiro/codex-queue/blob/main/docs/configuration.md) for session
homes, environment variables, storage, and platform details.

### Attach images and receive notifications

```bash
cq add "Investigate this screenshot" --image ./error.png
cq add "Review these designs" --image ./desktop.png --image ./mobile.png
```

The worker sends best-effort desktop notifications when a task completes,
fails, is interrupted, or enters `waiting_limit`. Run `cq doctor` to check
notification support.

## `codex queue` vs. `codex-queue`

Recent Codex CLI versions include a built-in command for queuing a message for
an existing session:

```bash
codex queue --thread <session-uuid> --message "Run the tests"
```

That is useful for one message in one existing session. `codex-queue` is for a
persistent local task queue with multiple jobs, multiple repositories,
usage-limit-aware retries, logs, notifications, and session resume.

See the full [Codex CLI queue comparison](https://github.com/rocioferreiro/codex-queue/blob/main/docs/codex-cli-queue-vs-codex-queue.md).

## CLI reference

The most common commands are:

```bash
cq start                         # Start the detached worker
cq add "Run the tests"           # Add a task for the current repository
cq add "Run deployment checks" --at "2026-09-07T10:00:00-03:00" # Schedule a task
cq status                        # Show worker and queue status
cq list                          # List jobs
cq show <id>                     # Inspect a job
cq logs <id>                     # Read job output
cq retry <id>                    # Retry an interrupted or failed job
cq schedule <id> --at <time>     # Change the next attempt time
cq cancel <id>                   # Cancel a pending or waiting job
cq stop                          # Stop the worker
```

See the complete [CLI reference](https://github.com/rocioferreiro/codex-queue/blob/main/docs/cli-reference.md), including job states,
images, notifications, logs, aliases, and worker behavior.

## Platform support

| Platform | Queue and worker | Desktop notifications |
| --- | --- | --- |
| macOS | Supported | Native Notification Center via `osascript` |
| Linux with a desktop session | Supported | `notify-send` with `libnotify` |
| Headless Linux/server | Supported | Not available without a notification daemon |
| Windows | Planned; not currently documented or tested | Planned |

On Debian or Ubuntu, install Linux notifications with:

```bash
sudo apt install libnotify-bin
```

Run `cq doctor` to check availability on the current machine.

## Configuration and troubleshooting

See [Configuration](https://github.com/rocioferreiro/codex-queue/blob/main/docs/configuration.md) for:

- environment variables such as `CQ_HOME`, `CQ_CODEX_BIN`, and `CQ_NOTIFY`;
- storage paths and privacy considerations;
- Codex session aliases and `CODEX_HOME` behavior;
- platform-specific notification details.

See [Troubleshooting](https://github.com/rocioferreiro/codex-queue/blob/main/docs/troubleshooting.md) for common installation,
worker, usage-limit, session, log, and notification issues.

## Install from source

```bash
git clone https://github.com/rocioferreiro/codex-queue.git
cd codex-queue
pnpm install
pnpm build
```

After building, run the CLI from the checkout with:

```bash
node dist/bin/cq.js --help
node dist/bin/cq.js doctor
```

For development without building, use `pnpm dev -- --help`.

## Roadmap

- [x] Persist and execute Codex jobs sequentially.
- [x] Detect usage limits and retry after the provider reset window.
- [x] Resume prompts in an existing Codex session.
- [ ] Add documented Windows support, including daemon process management,
  executable resolution, optional desktop notifications, and Windows CI.

Windows support is intentionally a future feature for now. The queue's core
foreground commands are expected to be close to portable, but the detached
daemon and native notification integrations still need a Windows-specific
implementation and testing.

## Development

```bash
pnpm install
pnpm test             # Run all tests
pnpm test:watch       # Watch tests
pnpm typecheck        # TypeScript checks
pnpm build            # Build the CLI and library into dist/
```

When changing behavior:

1. Add or update tests for the behavior.
2. Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
3. Keep changes focused and document user-visible CLI or storage changes.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, include a
concise description of the problem, the behavior you changed, and the
verification commands you ran. For larger changes, open an issue first so the
design can be discussed.

Please do not include real prompts, credentials, repository contents, or
private logs in issues, test fixtures, or pull requests. Use sanitized examples
instead.

For security-sensitive reports, avoid posting exploit details publicly. Open a
private security report through the repository's GitHub security contact when
available; otherwise contact the maintainers before opening a public issue.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

`codex-queue` is an independent open-source project and is not affiliated with
or endorsed by OpenAI.
