# CLI reference

Run `cq --help` or `cq <command> --help` for the installed command's complete
help text.

## Worker and daemon management

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

## Queue and job management

```bash
# Add a task; priority is high, normal, or low. `--at` accepts ISO 8601.
cq add "Implement feature A"
cq add "Fix a security vulnerability" --repo /path/to/repo --priority high
cq add "Run deployment checks" --at "2026-09-07T10:00:00-03:00"
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
cq resume <session-id>
cq resume <session-id> "Run the tests"
cq run 12 --verbose
cq wait 12
cq wait 12 --timeout 3600000

# Retry or cancel a job.
cq retry 12
cq schedule 12 --at "2026-09-07T12:30:00-03:00"
cq cancel 12
```

`cq run <id>` is an immediate execution path. It is useful for one-off work,
but use the worker for normal queue processing. A running job cannot be
cancelled directly; stop the worker to interrupt it, then retry it if needed.

`cq wait <id>` polls the local database, streams assistant messages from the
job log as they arrive, and exits successfully only when the job reaches
`completed`. It exits with a failure code for `failed`, `interrupted`,
`cancelled`, a missing job, or a timeout.

`cq schedule <id> --at <time>` changes the next attempt time for a pending,
waiting, failed, or interrupted job. Running, completed, and cancelled jobs
cannot be scheduled.

## Session aliases

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

| Command | Description |
| --- | --- |
| `cq alias set <name> --codex-home <path>` | Create or update a named Codex session alias. |
| `cq alias list` | List configured Codex session aliases. |
| `cq alias remove <name>` | Remove a named Codex session alias. |
| `cq doctor` | Check Codex, storage, configured sessions, and daemon health. |

## Images and notifications

Attach one or more local image files to a task with `--image` or `-i`. The flag
can be repeated or given a comma-separated list. Paths are resolved and
validated when the job is added, and must remain available until the worker
runs the task.

The worker sends a desktop notification when a task completes, fails, is
interrupted, or enters `waiting_limit`. Set `CQ_NOTIFY=0` to disable desktop
notifications. Run `cq doctor --notify-test` to verify the native notification
command accepts a test notification.

Notifications are best effort and never affect the queue; adapter errors are
written to `worker.log`.

## Logs

Job logs are stored as JSONL event streams. The worker log is plain text.

```bash
cq logs 12
cq logs 12 --raw
cq logs 12 --follow
cq logs worker
cq logs worker --follow
```

## Scheduling and job states

Jobs are ordered by priority (`high`, then `normal`, then `low`) and then by
creation time. A worker claims the next runnable job in an atomic SQLite
transaction, so multiple workers do not claim the same queued job.

| State | Meaning |
| --- | --- |
| `pending` | Ready to be claimed, or waiting for a manual retry. |
| `running` | Currently being executed by Codex. |
| `waiting_limit` | Paused until the detected reset time or a retry backoff. |
| `interrupted` | Stopped by shutdown or an unexpected worker exit. |
| `completed` | Codex exited successfully. |
| `failed` | Execution stopped after a non-retryable error or the maximum attempts. |
| `cancelled` | Cancelled before execution or while waiting. |
