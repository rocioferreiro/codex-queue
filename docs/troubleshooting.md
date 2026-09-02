# Troubleshooting

## Start with `cq doctor`

Run:

```bash
cq doctor
```

This checks Codex, storage, configured sessions, daemon health, and local
notification availability. Use `cq doctor --notify-test` to send a test
notification.

## Codex cannot be found

Make sure the Codex CLI is installed, authenticated, and available as `codex`:

```bash
codex --version
```

If the executable has another name or is not on `PATH`, configure it with:

```bash
export CQ_CODEX_BIN=/path/to/codex
cq doctor
```

## A job is waiting for a usage limit

`waiting_limit` means the worker detected a usage-limit response. Inspect the
scheduled attempt with:

```bash
cq status
cq list --status waiting_limit
cq show <job-id>
cq logs <job-id>
```

The worker waits for the detected reset time when available. It does not bypass
or extend the provider limit.

## The worker stopped or a job is interrupted

Check daemon health and restart it if needed:

```bash
cq status
cq restart
```

Jobs left in `running` after an unexpected worker exit are recovered as
`interrupted`. Retry them explicitly:

```bash
cq retry <job-id>
```

## An image cannot be used

Image paths are resolved and validated when the job is added. The files must
still exist when the worker runs the job:

```bash
cq add "Investigate this screenshot" --image ./error.png
```

Use an absolute path or keep the referenced file in place until execution.

## Notifications do not appear

Notifications are best effort and do not affect job execution. Check support
with:

```bash
cq doctor --notify-test
```

On Debian or Ubuntu, install `libnotify-bin`. Set `CQ_NOTIFY=0` to disable
notifications. Adapter errors are written to `worker.log`.

## Inspect raw logs

```bash
cq logs <job-id> --raw
cq logs worker --follow
```

Job logs are JSONL event streams; the worker log is plain text.
