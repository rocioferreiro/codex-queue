# codex-queue (`cq`)

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

## Why use it?

Codex usage limits do not need to interrupt a batch of independent tasks.
`codex-queue` records each task locally, detects usage-limit responses, parses
reset times when available, and schedules a retry with a 60-second safety
buffer. It does not bypass provider limits.

Everything managed by `codex-queue` stays on your machine: the SQLite database,
worker state, and job logs are stored under `~/.codex-queue` by default. The
Codex CLI itself may still communicate with its configured service.

## How is this different from `codex queue`?

Recent Codex CLI versions also include a built-in `codex queue` command for
queuing a message for an existing session:

```bash
codex queue --thread <session-uuid> --message "Run the tests"
```

That is useful when you want to send one message to one existing session. This
project is for a different workflow: queue multiple independent jobs locally,
run them across repositories, keep them after the terminal closes, wait for
detected usage-limit resets, retry failed work, inspect logs, send desktop
notifications, and resume sessions. Run `codex queue --help` to check the
capabilities of the Codex CLI version installed on your machine.

## Requirements

- Node.js 20 or newer
- pnpm (for installing and developing from source)
- The Codex CLI installed, authenticated, and available as `codex` on `PATH`
- A repository that Codex can access with its configured sandbox and permissions

### Platform support

The queue and worker are supported on macOS and Linux. Desktop notifications
are platform integrations, not a requirement for running the queue:

| Platform | Queue and worker | Desktop notifications |
| --- | --- | --- |
| macOS | Supported | Native Notification Center via `osascript` (title, subtitle, and sound) |
| Linux with a desktop session | Supported | `notify-send` when `libnotify` is installed |
| Headless Linux/server | Supported | Not available without a notification daemon; queue execution still works |
| Windows | Planned; not currently documented or tested | Planned; not supported by the built-in adapter |

On Debian or Ubuntu, install Linux notifications with `sudo apt install
libnotify-bin`. Run `cq doctor` to check availability on the current machine.

The runner invokes Codex with the equivalent of:

```text
codex exec --json --sandbox workspace-write -C <repository> <prompt>
```

For a job with a session ID, the runner uses `codex exec resume` and sends the
queued prompt to that existing session.

Image attachments are passed through as Codex `--image` arguments.

Use `CQ_CODEX_BIN` when the executable is not named `codex` or is not on your
`PATH`.

Each queued task can use a different Codex session by setting its home
directory. `codex-queue` stores the path on the job and applies it only while
that job runs.

Jobs can also resume an existing Codex session. Use `--session-id` when adding
a prompt, or use the dedicated resume command:

```bash
cq add "Review the changes" --session-id <session-id> --codex-home ~/.codex
cq resume <session-id>
cq resume <session-id> "Run the tests and fix any failures"
```

The `resume` command defaults to `Continue where you left off.`. When a job
hits a usage limit, its scheduled retry resumes the captured session with the
same continuation prompt after the reset time, instead of starting a new
session.

You can also configure named aliases for frequently used sessions:

```bash
cq alias set codex --codex-home ~/.codex
cq alias set codexwork --codex-home ~/.codex-work
cq alias set codexsti --codex-home ~/.codex-sti
cq alias list
cq alias remove codexsti
cq doctor
```

Alias names become command-line flags, so they must start with a letter and
contain only letters and numbers.

## Installation

For normal use, install the latest published release from npm:

```bash
npm install --global codex-queue
cq --help
```

The package exposes both `cq` and `codex-queue` commands.

### From source (development)

```bash
git clone https://github.com/rocioferreiro/codex-queue.git
cd codex-queue
pnpm install
pnpm build
```

After building, run the CLI from the checkout with:

```bash
node dist/bin/cq.js --help
```

For a quick health check:

```bash
node dist/bin/cq.js doctor
```

For development without building, use:

```bash
pnpm dev -- --help
```

## Quick start

Start the detached worker once:

```bash
cq start
```

Queue tasks from any directory. The current directory is used as the
repository unless `--repo` is supplied.

```bash
cd ~/projects/project-a
cq add \
  "Implement user authentication with JWT"

cd ~/projects/project-b
cq add \
  "Hotfix the production memory leak" --priority high \
  --codex-home ~/.codex-work
```

Inspect the queue and job output:

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

When running from source, replace `cq` in these examples with
`node dist/bin/cq.js`.

## Frequently asked questions

### Can I schedule messages in Codex after I hit the usage limit?

Yes—if by messages you mean task prompts for the Codex CLI. Start the worker
and add prompts before you run out of usage:

```bash
cq start
cq add "Implement the billing tests"
cq add "Review the authentication changes" --priority high
```

When Codex returns a usage-limit response, the job enters `waiting_limit` and
is retried after the detected reset time. The queue is local and does not
bypass usage limits.

See the detailed guide: [Queue Codex prompts after a usage limit](docs/queue-after-codex-usage-limit.md).

### Can I run Codex tasks overnight?

Yes. `cq start` launches a detached worker that continues after the terminal is
closed. Use `cq status`, `cq list`, and `cq logs <id>` to inspect progress.

See [Run Codex tasks overnight](docs/run-codex-tasks-overnight.md).

### Should I use `codex queue` or `codex-queue`?

Use `codex queue` for a message to an existing session. Use `codex-queue` when
you need a persistent local task queue, multiple jobs, cross-repository work,
usage-limit-aware retries, logs, notifications, or session resume.

See the comparison guide: [Codex CLI queue vs. codex-queue](docs/codex-cli-queue-vs-codex-queue.md).

## CLI reference

Run `cq --help` or `cq <command> --help` for the installed command's complete
help text.

### Worker and daemon management

| Command | Description |
| --- | --- |
| `cq start` | Start the detached background worker. |
| `cq stop` | Gracefully stop the background worker. An active job becomes `interrupted`. |
| `cq restart` | Stop and start the background worker. |
| `cq status` | Show daemon health, PID, queue counts, and the next scheduled attempt. |
| `cq worker` | Run the worker in the foreground. Supports `--interval <ms>` and `--verbose`. |
| `cq wait <id>` | Wait until a job completes, fails, is interrupted, or is cancelled. |

The worker processes one job at a time. If the process exits unexpectedly, jobs
left in `running` state are recovered as `interrupted` and require an explicit
retry.

### Session aliases

| Command | Description |
| --- | --- |
| `cq alias set <name> --codex-home <path>` | Create or update a named Codex session alias. |
| `cq alias list` | List configured Codex session aliases. |
| `cq alias remove <name>` | Remove a named Codex session alias. |
| `cq doctor` | Check Codex, storage, configured sessions, and daemon health. |

### Queue and job management

```bash
# Add a task; priority is high, normal, or low.
cq add "Implement feature A"
cq add "Fix a security vulnerability" --repo /path/to/repo --priority high
cq add "Use the work session" --codex-home ~/.codex-work
cq add "Use the work session" --codexwork
cq add "Continue this existing task" --session-id <session-id>
cq add "Investigate this screenshot" --image ./error.png
cq add "Review these designs" --image ./desktop.png --image ./mobile.png
cq add "Compare these screens" --image ./before.png,./after.png

# List jobs, optionally filtered and limited.
cq list
cq list --status waiting_limit
cq list --status interrupted --limit 20

# Inspect a job and execute it immediately.
cq show 12
cq run 12
cq resume <session-id>                 # Queue "Continue where you left off."
cq resume <session-id> "Run the tests" # Queue a custom continuation prompt
cq run 12 --verbose
cq wait 12                 # Wait for completion in scripts or another terminal
cq wait 12 --timeout 3600000

# Retry or cancel a job.
cq retry 12     # interrupted or failed -> pending
cq cancel 12    # pending, waiting_limit, or interrupted -> cancelled
```

`cq run <id>` is an immediate execution path. It is useful for one-off work,
but use the worker for normal queue processing. A running job cannot be
cancelled directly; stop the worker to interrupt it, then retry it if needed.

`cq wait <id>` polls the local database, streams assistant messages from the
job log as they arrive, and exits successfully only when the job reaches
`completed`. It exits with a failure code for `failed`, `interrupted`,
`cancelled`, a missing job, or a timeout.

### Images and notifications

Attach one or more local image files to a task with `--image` (or `-i`). The
flag can be repeated or given a comma-separated list. Paths are resolved and
validated when the job is added, and must remain available until the worker
runs the task.

The worker sends a desktop notification when a task completes, fails, is
interrupted, or enters `waiting_limit`. Set `CQ_NOTIFY=0` to disable desktop
notifications. Run `cq doctor --notify-test` to verify that the native desktop
notification command accepts a test notification. Notifications are best
effort and never affect the queue; adapter errors are written to `worker.log`.

Notifications use a status emoji, a short title, a status subtitle, and a
status-specific sound where the platform supports it. Linux also uses
standard desktop icon names. macOS does not allow `osascript` to select a
custom notification icon; it uses the icon of the notifying script/process.

### Logs

Job logs are stored as JSONL event streams. The worker log is plain text.

```bash
cq logs 12             # Human-readable job events
cq logs 12 --raw       # Raw JSONL
cq logs 12 --follow    # Follow a job log
cq logs worker         # Background worker log
cq logs worker --follow
```

## Scheduling and job states

Jobs are ordered by priority (`high`, then `normal`, then `low`) and then by
creation time. A worker claims the next runnable job in an atomic SQLite
transaction, so multiple workers do not claim the same queued job. The
foreground `cq run` command is an explicit immediate execution request and
should not be used concurrently with a worker for the same job.

Jobs can have these states:

| State | Meaning |
| --- | --- |
| `pending` | Ready to be claimed, or waiting for a manual retry. |
| `running` | Currently being executed by Codex. |
| `waiting_limit` | Paused until the detected reset time or a retry backoff. |
| `interrupted` | Stopped by shutdown or an unexpected worker exit. |
| `completed` | Codex exited successfully. |
| `failed` | Execution stopped after a non-retryable error or the maximum attempts. |
| `cancelled` | Cancelled before execution or while waiting. |

## Configuration and storage

By default, `codex-queue` creates this directory with owner-only permissions:

```text
~/.codex-queue/
├── codex-queue.db        # SQLite database (WAL mode)
├── worker.pid            # Background worker PID
├── worker-state.json     # Daemon metadata and instance token
├── worker.log            # Background worker log
└── logs/
    ├── job-1.jsonl       # Raw event stream for Job #1
    └── job-2.jsonl
```

| Variable | Description | Default |
| --- | --- | --- |
| `CQ_HOME` | Base directory for the database, state, and logs | `~/.codex-queue` |
| `CQ_DB_PATH` | SQLite database path | `$CQ_HOME/codex-queue.db` |
| `CQ_LOGS_DIR` | Directory for job logs | `$CQ_HOME/logs` |
| `CQ_CONFIG_PATH` | Path to the aliases configuration file | `$CQ_HOME/config.json` |
| `CQ_CODEX_BIN` | Codex executable path or name | `codex` |
| `CQ_NOTIFY` | Disable desktop notifications with `0`, `false`, or `never` | enabled |

If `--codex-home` is omitted, `cq add` captures the `CODEX_HOME` value from
the environment at creation time. If neither is set, the job uses the worker's
normal Codex environment.

Keep the database and logs private: prompts, error messages, thread IDs, and
execution events may contain project or other sensitive information.

## Development

```bash
pnpm install
pnpm test             # Run all tests
pnpm test:watch       # Watch tests during development
pnpm typecheck        # TypeScript checks
pnpm build            # Build the CLI and library into dist/
```

The source is organized by responsibility under `src/` (CLI, worker, daemon,
database, storage, runner, parser, and retry policy). Tests live in `tests/`.

When changing behavior:

1. Add or update tests for the behavior.
2. Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
3. Keep changes focused and document user-visible CLI or storage changes.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, please
include a concise description of the problem, the behavior you changed, and
the verification commands you ran. For larger changes, open an issue first so
the design can be discussed before implementation.

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
