# codex-queue (`cq`)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

**codex-queue** (`cq`) is a local, lightweight task queue CLI for persisting and executing Codex agent tasks sequentially using the installed [Codex CLI](https://github.com/openai/codex).

---

## Features

- ⚡ **Local SQLite Persistence**: Uses `better-sqlite3` with WAL mode to track job state and timestamps.
- 🔒 **Safe Process Execution**: Executes the Codex CLI using `node:child_process.spawn` with `shell: false` (no shell interpolation).
- 📜 **Streaming JSONL Parser**: Captures output from `codex exec --json --sandbox workspace-write -C <repo>` line by line.
- 🧵 **Codex Thread Tracking**: Extracts and persists the Codex `thread_id` directly in the database.
- 🗄 **Raw Log Retention**: Stores unmodified raw JSONL stream logs per job in `~/.codex-queue/logs/job-<id>.jsonl`.
- 📊 **Status Lifecycle**: Full lifecycle tracking: `pending` ➔ `running` ➔ `completed` / `failed`.
- 🧩 **Modular Architecture**: Clean separation between CLI, Database, Storage, Parser, and Runner layers.
- 🧪 **Vitest Test Suite**: Unit and integration tests covering database, parser, runner, and CLI.

---

## Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`
- **Codex CLI**: `codex` installed and available in `$PATH` (or configured via `CQ_CODEX_BIN`).

---

## Installation & Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-username/codex-queue.git
cd codex-queue
pnpm install
```

### Build

Build the TypeScript distribution files:

```bash
pnpm build
```

### Link CLI globally (Optional)

Link `cq` / `codex-queue` to your local environment:

```bash
pnpm link --global
```

Or run directly with `tsx` during development:

```bash
pnpm dev --help
```

---

## CLI Usage

### 1. Add a Task to the Queue (`cq add`)

Queues a new task using the current working directory as the target repository root:

```bash
cq add "Implement authentication middleware with JWT"
```

You can also specify a custom repository path:

```bash
cq add "Fix issue with user registration" -C /path/to/project
```

Output:
```text
✔ Job #1 created successfully
  Status:    pending
  Repo:      /path/to/project
  Prompt:    Fix issue with user registration

Run this job with: cq run 1
```

---

### 2. List Queued Tasks (`cq list`)

View all tasks in the queue:

```bash
cq list
```

Filter by status (`pending`, `running`, `completed`, `failed`):

```bash
cq list --status pending
cq list --status completed
```

Example Output:
```text
ID     STATUS        THREAD ID         CREATED             PROMPT
────────────────────────────────────────────────────────────────────────────────
#1     completed     th_01HJ8Z90K...   Sep 1, 12:30:15 PM  Fix issue with user registration
#2     pending       -                 Sep 1, 12:32:00 PM  Implement authentication middleware

Total: 2 job(s)
```

---

### 3. Run a Task (`cq run <id>`)

Executes a job using the Codex CLI (`codex exec --json --sandbox workspace-write -C <repo> <prompt>`):

```bash
cq run 1
```

Run with verbose event logs:

```bash
cq run 1 --verbose
```

Output:
```text
▶ Starting Job #1
  Repo:   /path/to/project
  Prompt: Fix issue with user registration
────────────────────────────────────────────────────────────
✔ Captured Codex thread_id: th_01HJ8Z90K7PQ123
────────────────────────────────────────────────────────────
✔ Job #1 completed successfully in 14.32s
  Thread ID: th_01HJ8Z90K7PQ123
  Log File:  ~/.codex-queue/logs/job-1.jsonl
```

---

## Storage & Configuration

By default, data is stored in `~/.codex-queue`:

```text
~/.codex-queue/
├── codex-queue.db        # SQLite database storing jobs and statuses
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

## Architecture

The project is designed with modularity in mind:

```text
src/
├── cli/              # Commander CLI commands (add, list, run) and entry points
│   ├── commands/     # Command handlers
│   ├── index.ts      # Command definitions
│   └── bin.ts        # CLI executable launcher
├── db/               # SQLite database client, schema, and repository methods
│   ├── client.ts     # SQLite connection & WAL mode
│   ├── schema.ts     # Database DDL
│   └── jobs.ts       # Job CRUD & status management
├── storage/          # Path resolutions and raw log file handling
│   ├── paths.ts      # Data directories & environment paths
│   └── logs.ts       # Per-job write stream & reading
├── parser/           # Streaming JSONL line parser and event interpreter
│   ├── jsonl.ts      # Chunk-safe line parser
│   └── events.ts     # Thread ID & event metadata extractor
├── runner/           # Process runner wrapping child_process.spawn
│   ├── codex-runner.ts # Executes `codex exec` with proper isolation
│   └── types.ts      # Runner interfaces
├── types/            # Domain interfaces (Job, JobStatus, RunnerResult)
└── index.ts          # Public library exports
```

---

## Testing

Run tests with [Vitest](https://vitest.dev/):

```bash
pnpm test
```

Run test suite in watch mode:

```bash
pnpm test:watch
```

Run TypeScript typecheck:

```bash
pnpm typecheck
```

---

## Recommended Next Steps

Based on the roadmap for future milestones:

1. **Auto-Runner / Daemon Mode (`cq start` / `cq worker`)**:
   - Background worker process that continuously polls for `pending` jobs and executes them sequentially.
   - PID file management and graceful shutdown (`SIGINT` / `SIGTERM` signal handlers).
2. **Scheduling & Cron Support (`cq schedule`)**:
   - Support one-time delay (`--at "14:00"`, `--in "30m"`) and recurring cron syntax.
3. **Retries & Error Handling Policies**:
   - Configurable max retries, exponential backoff, and failure thresholds.
4. **Multiple `CODEX_HOME` / Multi-Account Profiles**:
   - Assign jobs to specific Codex profiles or API keys (`--account <name>` / `--codex-home <path>`).
5. **Resume & Fork Previous Threads (`cq resume <id>`)**:
   - Leverage the captured `thread_id` to resume conversation contexts using `codex exec resume <thread_id>`.
6. **TUI / Terminal Dashboard**:
   - Interactive terminal UI (e.g. via `ink` or `blessed`) to monitor running jobs and view live logs.

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
