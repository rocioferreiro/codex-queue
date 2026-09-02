# Codex CLI queue vs. codex-queue

These tools solve related but different problems.

| Need | Recommended tool |
| --- | --- |
| Send one message to an existing Codex session | `codex queue` |
| Queue several independent prompts | `codex-queue` |
| Keep work after closing the terminal | `codex-queue` |
| Run jobs from multiple repositories | `codex-queue` |
| Wait for a detected usage-limit reset | `codex-queue` |
| Inspect job states and JSONL logs | `codex-queue` |
| Resume an existing session as a queued job | `codex-queue` |

The built-in Codex CLI command has the following shape:

```bash
codex queue --thread <session-uuid> --message "Run the tests"
```

It targets an existing session. Check the installed CLI for the complete
interface:

```bash
codex queue --help
```

For a durable local workflow, use:

```bash
cq start
cq add "Run the tests and fix any failures" --session-id <session-uuid>
```

`codex-queue` is an external wrapper around the Codex CLI. It does not bypass
provider limits and is not affiliated with or endorsed by OpenAI.

