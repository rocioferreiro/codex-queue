# How to queue Codex prompts after hitting a usage limit

`codex-queue` is designed for the case where you have more Codex CLI work to
do but the current usage window has been exhausted.

## Install and start the worker

```bash
npm install --global codex-queue
cq start
```

The Codex CLI must already be installed, authenticated, and available as
`codex` on `PATH`.

## Add prompts before or after the limit

```bash
cd ~/projects/project-a
cq add "Implement the billing tests"

cd ~/projects/project-b
cq add "Review the authentication changes" --priority high
```

The current directory is captured as the job repository. Use `--repo` when the
job should run somewhere else.

## What happens at the limit?

When Codex returns a usage-limit response, the worker moves the job to
`waiting_limit`. It parses the reset time when one is available, waits until
that time with a safety buffer, and retries the job. If the response has no
usable reset time, the retry policy uses its backoff instead.

Inspect the queue with:

```bash
cq status
cq list --status waiting_limit
cq show <job-id>
cq logs <job-id>
```

This does not bypass, extend, or redeem a provider limit. It only stores the
work locally and runs it when the Codex CLI becomes available again.

## Resume an existing session

```bash
cq add "Continue the migration" --session-id <session-id>
cq resume <session-id> "Run the tests and fix any failures"
```

The scheduled retry resumes the captured session with the same continuation
prompt.

