# Run Codex tasks overnight

Use `codex-queue` when you want to prepare several Codex CLI tasks and let them
run in the background while you are away from the terminal.

```bash
npm install --global codex-queue
cq start

cd ~/projects/api
cq add "Add request validation and tests"

cd ~/projects/web
cq add "Review the accessibility of the settings page"
```

The detached worker runs one job at a time. It preserves jobs in a local
SQLite database, so closing the terminal does not remove the queue.

Check progress the next morning:

```bash
cq status
cq list
cq show 1
cq logs 1
```

The worker also sends a desktop notification when a job completes, fails, is
interrupted, or enters `waiting_limit`. Run `cq doctor` to check the local
installation and notification support.

Stop the worker when you are done:

```bash
cq stop
```

