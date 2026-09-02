#!/usr/bin/env node

const args = process.argv.slice(2);
const isResume = args[1] === 'resume';
const jsonOptionIndex = args.indexOf('--json');
const sessionId = isResume && jsonOptionIndex >= 0 ? args[jsonOptionIndex + 1] : 'fake-session-created';
const mode = process.env.CQ_FAKE_CODEX_MODE || 'success';

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

emit({ type: 'thread.started', thread_id: sessionId });
emit({ type: 'fake.invocation', is_resume: isResume, prompt: args.at(-1) });

if (mode === 'usage-limit') {
  emit({
    type: 'turn.failed',
    error: { message: "You've hit your usage limit. Try again later." },
  });
  process.exit(1);
}

emit({ type: 'item.completed', item: { type: 'agent_message', text: 'Fake Codex completed the task.' } });
process.exit(0);
