# codex-queue (`cq`)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

**codex-queue** (`cq`) is an availability-aware task queue CLI for persisting Codex tasks locally and executing them automatically when Codex capacity becomes available.

---

## The Primary Use Case

> **Queue tasks now, let them execute when Codex capacity becomes available.**

When you hit your hourly or monthly Codex usage limit, you don't need to manually check back and wait. Simply queue tasks with `cq add` and run `cq worker`. The worker:
1. Detects usage limits and extracts the exact reset time from Codex output (with an automated 60-second safety buffer).
2. If no reset timestamp is available, schedules a progressive exponential backoff (starting at 10 minutes, then 20m, 40m, up to 60m).
3. Sets the job status to `waiting_limit` with `next_attempt_at`.
4. Automatically resumes and executes tasks in priority order as soon as Codex becomes available again.

---

## Features

- ⚡ **Local SQLite Persistence**: Uses `better-sqlite3` with WAL mode and automatic schema migrations.
- 🎯 **Priority Queueing**: Supports `high`, `normal`, and `low` priorities (`priority DESC, created_at ASC`).
- 🤖 **Availability-Aware Worker (`cq worker`)**: Single-concurrency foreground worker that polls SQLite and executes runnable jobs safely.
- 🔒 **Duplicate Execution Prevention**: Atomic SQLite transactions guarantee multiple workers will never execute the same job concurrently.
- 🕒 **Usage Limit Detection & Reset Extraction**: Encapsulated classifier extracts reset timestamps (e.g. `Sep 1st, 2026 5:32 PM`) + 60s safety buffer.
- 🔁 **Resilient Retry Policies**: 10m/20m/40m/60m backoff for usage limits without parsed dates; exponential backoff for rate limits and 5xx errors; immediate failure on auth or sandbox violations.
- 🛑 **Graceful Shutdown & Interrupted State**: On `SIGINT`/`SIGTERM` or crash, active jobs transition to `interrupted` instead of being blindly re-executed.
- 🔄 **Manual Retry (`cq retry <id>`)**: Reset `interrupted` or `failed` jobs to `pending` while preserving historical attempt counts.
- ❌ **Job Cancellation (`cq cancel <id>`)**: Cancel `pending`, `waiting_limit`, or `interrupted` jobs safely.
- 📜 **Streaming JSONL Parser**: Captures output from `codex exec --json --sandbox workspace-write -C <repo>` line by line.
- 🧵 **Codex Thread Tracking**: Extracts and persists the Codex `thread_id` directly in the database.
- 🗄 **Raw Log Retention**: Stores unmodified raw JSONL stream logs per job in `~/.codex-queue/logs/job-<id>.jsonl`.
- 📊 **Status Lifecycle**: `pending` ➔ `running` ➔ `waiting_limit` ➔ `completed` / `failed` / `interrupted` / `cancelled`.

---

## Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`
- **Codex CLI**: `codex` installed and available in `$PATH` (or configured via `CQ_CODEX_BIN`).

---

## Installation & Setup

```bash
git clone https://github.com/your-username/codex-queue.git
cd codex-queue
pnpm install
pnpm build
```

Link `cq` / `codex-queue` globally:

```bash
pnpm link --global
```

Or run via `tsx` during development:

```bash
pnpm dev --help
```

---

## CLI Usage

### 1. Add Tasks (`cq add`)

Queue tasks with priority (`high`, `normal`, `low`):

```bash
# Default normal priority in current working directory
cq add "Implement user authentication with JWT"

# High priority task
cq add "Hotfix critical production memory leak" --priority high

# Specific repo path and low priority
cq add "Refactor test helper utilities" -C /path/to/project --priority low
```

---

### 2. Start the Worker (`cq worker`)

Start the continuous queue worker in the foreground:

```bash
cq worker
```

Run in verbose mode to view reset extraction and retry policy decisions:

```bash
cq worker --verbose
```

**Worker Observability Output:**
```text
codex-queue worker started
[17:31:02] job #12 starting
[17:31:04] Codex usage limit reached
[17:31:04]   Usage limit classified from: stderr message
[17:31:04]   Reset time extraction: Sep 1, 2026 17:41 (parsed_absolute)
[17:31:04]   Safety buffer: +60s
[17:31:04] job #12 waiting until 17:42:00

[17:42:01] job #12 retrying (attempt 2)
[17:48:12] job #12 completed
```

The worker gracefully handles `SIGINT` (Ctrl+C) and `SIGTERM`, safely aborting active Codex child processes and marking the job as `interrupted` before exiting.

---

### 3. List Queued Tasks (`cq list`)

View all tasks, their priorities, attempts, and next retry schedules:

```bash
cq list
```

Filter by status (`pending`, `running`, `waiting_limit`, `interrupted`, `completed`, `failed`, `cancelled`):

```bash
cq list --status waiting_limit
cq list --status interrupted
```

**Example Output:**
```text
ID    PRIORITY  STATUS         ATTEMPTS  NEXT ATTEMPT         THREAD ID      PROMPT
───────────────────────────────────────────────────────────────────────────────────────────────
#12   high      waiting_limit  1         Sep 1, 05:42:00 PM   -              Hotfix critical memory leak
#13   normal    interrupted    1         -                    -              Interrupted task
#14   low       pending        0         -                    -              Refactor tests

Total: 3 job(s)
```

---

### 4. Retry an Interrupted or Failed Task (`cq retry <id>`)

Return an `interrupted` or `failed` job to `pending` state (preserving the existing attempt count):

```bash
cq retry 13
```

---

### 5. Execute a Task Immediately (`cq run <id>`)

Run a specific job on-demand without running the worker:

```bash
cq run 12
```

---

### 6. Cancel a Task (`cq cancel <id>`)

Cancel any `pending`, `waiting_limit`, or `interrupted` task:

```bash
cq cancel 14
```

---

## Error Classification & Reset Parsing

`codex exec --json` does not currently expose Codex's internal structured `CodexErrorInfo` consistently.

Therefore, `codex-queue` includes an isolated error classification layer (`src/classifier/`) that:
1. First inspects structured error fields if present in JSONL events.
2. Falls back to human-readable error parsing for usage limits, rate limits, authentication errors, and sandbox violations.
3. Parses natural language reset strings (e.g. `"Try again at Sep 1st, 2026 5:32 PM"` or `"in 15 minutes"`) and converts them into standardized UTC timestamps.
4. Adds a **60-second safety buffer** past the parsed reset time to prevent edge-case race conditions on the Codex provider.
5. If no reset timestamp is found, applies a progressive fallback backoff policy for usage limits:
   - **Attempt 1**: 10 minutes
   - **Attempt 2**: 20 minutes
   - **Attempt 3**: 40 minutes
   - **Attempt 4+**: Capped at 60 minutes

---

## Storage & Configuration

By default, data is stored in `~/.codex-queue`:

```text
~/.codex-queue/
├── codex-queue.db        # SQLite database storing jobs, retries, and statuses
└── logs/
    ├── job-1.jsonl       # Full raw JSONL events from Codex execution
    └── job-2.jsonl
```

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CQ_HOME` | Base directory for database and log files | `~/.codex-queue` |
| `CQ_DB_PATH` | Path to the SQLite database file | `$CQ_HOME/codex-queue.db` |
| `CQ_LOGS_DIR` | Path to directory where job logs are saved | `$CQ_HOME/logs` |
| `CQ_CODEX_BIN` | Path or name of the `codex` executable | `codex` |

---

## Testing

Run the test suite with Vitest:

```bash
pnpm test
```

Watch mode for TDD:

```bash
pnpm test:watch
```

Typecheck:

```bash
pnpm typecheck
```

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
