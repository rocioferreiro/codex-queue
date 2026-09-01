import { describe, it, expect } from 'vitest';
import { JsonlParser, parseJsonlString } from '../src/parser/jsonl.js';
import { extractThreadId, formatCodexEventSummary } from '../src/parser/events.js';

describe('JSONL Parser & Event Processing', () => {
  it('parses multiple JSON lines correctly', () => {
    const raw = '{"type":"turn.start","id":"1"}\n{"type":"message","text":"hello"}\n';
    const { events, errors } = parseJsonlString(raw);

    expect(errors).toHaveLength(0);
    expect(events).toEqual([
      { type: 'turn.start', id: '1' },
      { type: 'message', text: 'hello' },
    ]);
  });

  it('handles chunked streams with split lines', () => {
    const parsed: unknown[] = [];
    const parser = new JsonlParser({
      onEvent: (evt) => parsed.push(evt),
    });

    parser.feed('{"type":"turn.');
    expect(parsed).toHaveLength(0);

    parser.feed('start","thread_id":"th_123"}\n{"type":"step');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ type: 'turn.start', thread_id: 'th_123' });

    parser.feed('","num":1}\n');
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ type: 'step', num: 1 });
  });

  it('handles non-JSON lines and reports error via callback', () => {
    const errors: string[] = [];
    const parser = new JsonlParser({
      onError: (_err, line) => errors.push(line),
    });

    parser.feed('some non-json logging output\n{"valid": true}\n');
    expect(errors).toEqual(['some non-json logging output']);
  });

  describe('extractThreadId', () => {
    it('extracts thread_id at root', () => {
      expect(extractThreadId({ thread_id: 'th_abc1' })).toBe('th_abc1');
      expect(extractThreadId({ threadId: 'th_abc2' })).toBe('th_abc2');
    });

    it('extracts thread id from nested thread object', () => {
      expect(extractThreadId({ thread: { id: 'th_nested_1' } })).toBe('th_nested_1');
    });

    it('extracts thread id from nested data object', () => {
      expect(extractThreadId({ data: { thread_id: 'th_data_1' } })).toBe('th_data_1');
      expect(extractThreadId({ type: 'thread.created', data: { id: 'th_data_2' } })).toBe('th_data_2');
    });

    it('extracts session_id if present', () => {
      expect(extractThreadId({ session_id: 'sess_123' })).toBe('sess_123');
      expect(extractThreadId({ sessionId: 'sess_456' })).toBe('sess_456');
    });

    it('extracts id from thread.created event', () => {
      expect(extractThreadId({ type: 'thread.created', id: 'th_event_id' })).toBe('th_event_id');
      expect(extractThreadId({ type: 'session.created', id: 'sess_event_id' })).toBe('sess_event_id');
    });

    it('returns null if no thread ID found', () => {
      expect(extractThreadId({ type: 'message', content: 'hello' })).toBeNull();
      expect(extractThreadId(null)).toBeNull();
      expect(extractThreadId('invalid')).toBeNull();
    });
  });

  describe('formatCodexEventSummary', () => {
    it('formats thread events', () => {
      const summary = formatCodexEventSummary({ type: 'thread.created', thread_id: 'th_123' });
      expect(summary).toBe('Thread ID: th_123');
    });

    it('formats message events', () => {
      const summary = formatCodexEventSummary({ type: 'message.delta' });
      expect(summary).toBe('Message event: message.delta');
    });
  });
});
