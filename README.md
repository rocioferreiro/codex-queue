# codex-queue (`cq`)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

**codex-queue** (`cq`) is a local, availability-aware task queue and background worker for the Codex CLI.

Queue tasks now from any directory, close the terminal, and let `codex-queue` run them automatically in the background as soon as Codex capacity becomes available.

---

## The Primary User Workflow

```bash
# 1. Start the local background worker daemon
cq start

# 2. Queue tasks from different project repositories
cd ~/projects/project-a
cq add "Implement user authentication with JWT"

cd ~/projects/project-b
cq add "Hotfix critical production memory leak" --priority high

# 3. Close the terminal or continue working normally

# 4. Check status and queue metrics anytime
cq status

# 5. Inspect specific jobs and logs
cq show 1
cq logs 1
cq logs worker

# 6. Stop the daemon when desired
cq stop
```

---

## Key Features

- 🕒 **Availability-Aware Scheduling**: Detects Codex usage limits, extracts exact reset times (`"try again at 8:09 PM"` or `"in 15 minutes"`), applies a 60-second safety buffer, and auto-resumes execution.
- 🔄 **Background Daemon (`cq start` / `cq stop` / `cq status` / `cq restart`)**: Spawns a detached background worker that survives closing your terminal.
- 🛡 **Safe PID Verification & Stale State Recovery**: Protects against PID reuse by verifying process command identity before sending signals.
- 🔍 **Job & Log Observability (`cq show` / `cq logs`)**: Full metadata inspection and pretty-printed JSONL event stream logs.
- ⚡ **Local SQLite Persistence**: Uses `better-sqlite3` with WAL mode and automatic schema migrations.
- 🎯 **Priority Queueing**: Supports `high`, `normal`, and `low` priorities (`priority DESC, created_at ASC`).
- 🔒 **Duplicate Execution Prevention**: Atomic SQLite transactions guarantee tasks are never executed twice.
- 🛑 **Graceful Shutdown & Interrupted State**: On `SIGINT`/`SIGTERM`, active Codex jobs transition safely to `interrupted` without orphaned processes.
- 🔄 **Manual Retry (`cq retry <id>`)**: Reset `interrupted` or `failed` jobs back to `pending` while preserving attempt history.

---

## Important Operational Semantics

- **Local Only**: Everything is stored on your local machine in `~/.codex-queue/`. No external cloud or background telemetry.
- **Sleep & Power**: If your computer is asleep or powered off, tasks will not run. When your machine wakes up or the worker is started, any missed or pending tasks immediately become runnable in priority order.
- **Provider Limits**: `codex-queue` does not attempt to bypass provider usage limits; it schedules work strictly when capacity is restored.

---

## CLI Reference

### Daemon Management

| Command | Description | Exit Code |
| :--- | :--- | :--- |
| `cq start` | Starts the background worker daemon. | `0` on success, `3` if already running. |
| `cq stop` | Gracefully stops the verified background daemon. | `0` on success, `4` if not running. |
| `cq restart` | Restarts the background worker daemon. | `0` on success. |
| `cq status` | Displays daemon health, PID, and live queue metrics. | `0` on success. |

**Example `cq status` output:**
```text
codex-queue is running

PID:                  12345
Started:              Sep 1, 2026, 06:45 PM
Log:                  ~/.codex-queue/worker.log
Current job:          #12
Pending:              3
Waiting for capacity: 1
Interrupted:          0
Failed:               0
Next attempt:         Sep 1, 2026, 08:10 PM
CQ_HOME:              ~/.codex-queue
```

---

### Task Management & Queueing

#### 1. Add Tasks (`cq add`)
```bash
# Normal priority in current directory
cq add "Implement feature A"

# High priority in specific repository
cq add "Fix security vulnerability" -C /path/to/repo --priority high
```

#### 2. List Tasks (`cq list`)
```bash
cq list
cq list --status waiting_limit
cq list --status interrupted
```

#### 3. Inspect a Job (`cq show <id>`)
```bash
cq show 12
```

**Example output:**
```text
Job #12

Status:         waiting_limit
Priority:       high
Attempts:       1
Repo:           /Users/user/projects/api
Created:        Sep 1, 2026, 06:30 PM
Started:        Sep 1, 2026, 06:31 PM
Completed:      -
Next attempt:   Sep 1, 2026, 08:10 PM
Failure kind:   usage_limit
Last error:     You've hit your usage limit. Try again at 8:09 PM.
Thread ID:      01a05ddc-6cd1-7f31-be39-0d2bed3dbdee
Log file:       ~/.codex-queue/logs/job-12.jsonl

Prompt:
────────────────────────────────────────────────────────────
Implement feature A
────────────────────────────────────────────────────────────
```

#### 4. View Logs (`cq logs`)
```bash
# Pretty-print events for a specific job
cq logs 12

# Stream raw JSONL events
cq logs 12 --raw

# Follow job logs in real time
cq logs 12 --follow

# View background worker log
cq logs worker
cq logs worker --follow
```

#### 5. Execute On-Demand (`cq run <id>`)
```bash
cq run 12
```

#### 6. Retry or Cancel Tasks
```bash
cq retry 12    # Reset interrupted or failed job to pending
cq cancel 12   # Cancel a pending or waiting task
```

---

## Storage & Configuration

By default, data is stored in `~/.codex-queue`:

```text
~/.codex-queue/
├── codex-queue.db        # SQLite database (WAL mode)
├── worker.pid            # Active daemon PID
├── worker-state.json     # Daemon metadata & instance token
├── worker.log            # Background worker event log
└── logs/
    ├── job-1.jsonl       # Raw JSONL event stream for Job #1
    └── job-2.jsonl
```

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CQ_HOME` | Base directory for database, PID, and log files | `~/.codex-queue` |
| `CQ_DB_PATH` | Path to SQLite database file | `$CQ_HOME/codex-queue.db` |
| `CQ_LOGS_DIR` | Path to directory where job logs are saved | `$CQ_HOME/logs` |
| `CQ_CODEX_BIN` | Path or name of the `codex` executable | `codex` |

---

## Testing

```bash
# Run all unit and integration test suites
pnpm test

# Watch mode for TDD
pnpm test:watch

# Typecheck
pnpm typecheck

# Production build
pnpm build
```

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
