# codex-queue (`cq`)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

`codex-queue` is a local, persistent task queue and background worker for the
Codex CLI. Queue work from any repository, close your terminal, and let the
worker execute jobs sequentially when Codex is available again.

> **Project status:** early development (`0.x`). The CLI and storage format may
> change between releases.

## Why use it?

Codex usage limits do not need to interrupt a batch of independent tasks.
`codex-queue` records each task locally, detects usage-limit responses, parses
reset times when available, and schedules a retry with a 60-second safety
buffer. It does not bypass provider limits.

Everything managed by `codex-queue` stays on your machine: the SQLite database,
worker state, and job logs are stored under `~/.codex-queue` by default. The
Codex CLI itself may still communicate with its configured service.

## Requirements

- Node.js 20 or newer
- pnpm (for installing and developing from source)
- The Codex CLI installed, authenticated, and available as `codex` on `PATH`
- A repository that Codex can access with its configured sandbox and permissions

The runner invokes Codex with the equivalent of:

```text
codex exec --json --sandbox workspace-write -C <repository> <prompt>
```

Image attachments are passed through as Codex `--image` arguments.

Use `CQ_CODEX_BIN` when the executable is not named `codex` or is not on your
`PATH`.

Each queued task can use a different Codex session by setting its home
directory. `codex-queue` stores the path on the job and applies it only while
that job runs.

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
```

To make `cq` and `codex-queue` available as global commands during local
development, link the package after building:

```bash
pnpm link --global
cq --help
```

Alternatively, invoke the binary through `node dist/bin/cq.js`.

## Quick start

Start the detached worker once:

```bash
node dist/bin/cq.js start
```

Queue tasks from any directory. The current directory is used as the
repository unless `--repo` is supplied.

```bash
cd ~/projects/project-a
node /path/to/codex-queue/dist/bin/cq.js add \
  "Implement user authentication with JWT"

cd ~/projects/project-b
node /path/to/codex-queue/dist/bin/cq.js add \
  "Hotfix the production memory leak" --priority high \
  --codex-home ~/.codex-work
```

Inspect the queue and job output:

```bash
node /path/to/codex-queue/dist/bin/cq.js status
node /path/to/codex-queue/dist/bin/cq.js list
node /path/to/codex-queue/dist/bin/cq.js show 1
node /path/to/codex-queue/dist/bin/cq.js logs 1
```

Stop the worker when you no longer need it:

```bash
node /path/to/codex-queue/dist/bin/cq.js stop
```

For the examples below, `cq` is shorthand for the built command shown above.

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

`cq wait <id>` polls the local database and exits successfully only when the
job reaches `completed`. It exits with a failure code for `failed`,
`interrupted`, `cancelled`, a missing job, or a timeout.

### Images and notifications

Attach one or more local image files to a task with `--image` (or `-i`). The
flag can be repeated or given a comma-separated list. Paths are resolved and
validated when the job is added, and must remain available until the worker
runs the task.

The worker sends a desktop notification when a task completes, fails, is
interrupted, or enters `waiting_limit`. Set `CQ_NOTIFY=0` to disable desktop
notifications. Notifications are best effort and never affect the queue.

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
