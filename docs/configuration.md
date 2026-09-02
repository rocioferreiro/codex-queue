# Configuration

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `CQ_HOME` | Base directory for the database, state, and logs | `~/.codex-queue` |
| `CQ_DB_PATH` | SQLite database path | `$CQ_HOME/codex-queue.db` |
| `CQ_LOGS_DIR` | Directory for job logs | `$CQ_HOME/logs` |
| `CQ_CONFIG_PATH` | Path to the aliases configuration file | `$CQ_HOME/config.json` |
| `CQ_CODEX_BIN` | Codex executable path or name | `codex` |
| `CQ_NOTIFY` | Disable desktop notifications with `0`, `false`, or `never` | enabled |

Use `CQ_CODEX_BIN` when the executable is not named `codex` or is not on your
`PATH`.

If `--codex-home` is omitted, `cq add` captures the `CODEX_HOME` value from the
environment at creation time. If neither is set, the job uses the worker's
normal Codex environment.

## Session aliases

Aliases are shortcuts for frequently used Codex homes:

```bash
cq alias set codex --codex-home ~/.codex
cq alias set codexwork --codex-home ~/.codex-work
cq add "Run the work task" --codexwork
```

Each queued task can use a different Codex session home. `codex-queue` stores
the path on the job and applies it only while that job runs.

## Storage

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

Keep the database and logs private: prompts, error messages, thread IDs, and
execution events may contain project or other sensitive information.

## Codex invocation

The runner invokes Codex with the equivalent of:

```text
codex exec --json --sandbox workspace-write -C <repository> <prompt>
```

For a job with a session ID, the runner uses `codex exec resume` and sends the
queued prompt to that existing session. Image attachments are passed through as
Codex `--image` arguments.

## Notifications by platform

- macOS uses Notification Center through `osascript`.
- Linux uses `notify-send` when `libnotify` is installed.
- Headless Linux can run the queue without desktop notifications.
- Windows notifications are planned and not currently supported by the built-in
  adapter.

On Debian or Ubuntu:

```bash
sudo apt install libnotify-bin
```

Run `cq doctor --notify-test` to test the configured notification adapter.
