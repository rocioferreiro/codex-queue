import type { CodexParsedEvent } from '../types/job.js';

/**
 * Extracts thread_id from arbitrary Codex event structures.
 * Codex CLI outputs various JSON events such as thread.created, session.created, turn notifications, etc.
 */
export function extractThreadId(event: unknown): string | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const obj = event as Record<string, unknown>;

  // Direct thread_id / threadId
  if (typeof obj.thread_id === 'string' && obj.thread_id.trim()) {
    return obj.thread_id.trim();
  }
  if (typeof obj.threadId === 'string' && obj.threadId.trim()) {
    return obj.threadId.trim();
  }

  // Nested in thread object: { thread: { id: "..." } }
  if (obj.thread && typeof obj.thread === 'object') {
    const thread = obj.thread as Record<string, unknown>;
    if (typeof thread.id === 'string' && thread.id.trim()) {
      return thread.id.trim();
    }
  }

  // Nested in data: { data: { thread_id: "..." } } or { data: { id: "..." } } when type matches thread
  if (obj.data && typeof obj.data === 'object') {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.thread_id === 'string' && data.thread_id.trim()) {
      return data.thread_id.trim();
    }
    if (typeof data.threadId === 'string' && data.threadId.trim()) {
      return data.threadId.trim();
    }
    if (
      typeof data.id === 'string' &&
      data.id.trim() &&
      (typeof obj.type === 'string' && (obj.type.includes('thread') || obj.type.includes('session')))
    ) {
      return data.id.trim();
    }
  }

  // Session ID as fallback if thread_id is not explicitly named
  if (typeof obj.session_id === 'string' && obj.session_id.trim()) {
    return obj.session_id.trim();
  }
  if (typeof obj.sessionId === 'string' && obj.sessionId.trim()) {
    return obj.sessionId.trim();
  }

  // If type is thread.created or session.created and id is present
  if (
    typeof obj.type === 'string' &&
    (obj.type === 'thread.created' || obj.type === 'session.created' || obj.type === 'thread_created') &&
    typeof obj.id === 'string' &&
    obj.id.trim()
  ) {
    return obj.id.trim();
  }

  return null;
}

/** Extract assistant-visible text from Codex JSONL message events. */
export function extractCodexMessage(event: CodexParsedEvent): string | null {
  if (!event || typeof event !== 'object') return null;

  const rootType = String(event.type || event.event || '').toLowerCase();
  const item = event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : null;
  const itemType = item ? String(item.type || '').toLowerCase() : '';

  if (item && (itemType === 'agent_message' || itemType === 'assistant_message')) {
    if (typeof item.text === 'string' && item.text.trim()) return item.text;
    if (typeof item.content === 'string' && item.content.trim()) return item.content;
  }

  if (
    (rootType === 'agent_message' || rootType === 'assistant_message' || rootType === 'message') &&
    typeof event.text === 'string' &&
    event.text.trim()
  ) {
    return event.text;
  }

  return null;
}

/**
 * Formats a short human-readable summary of a Codex event for CLI streaming.
 */
export function formatCodexEventSummary(event: CodexParsedEvent): string | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const type = String(event.type || event.event || '');
  if (!type) return null;

  const message = extractCodexMessage(event);
  if (message) return message;

  if (type.includes('thread') || type.includes('session')) {
    const threadId = extractThreadId(event);
    return threadId ? `Thread ID: ${threadId}` : `Session event (${type})`;
  }

  if (type.includes('message') || type.includes('text') || type.includes('content')) {
    return `Message event: ${type}`;
  }

  return `Event: ${type}`;
}
