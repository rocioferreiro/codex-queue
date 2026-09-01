export interface JsonlParserOptions {
  onEvent?: (event: unknown, rawLine: string) => void;
  onRawLine?: (rawLine: string) => void;
  onError?: (error: Error, rawLine: string) => void;
}

export class JsonlParser {
  private buffer = '';
  private onEvent?: (event: unknown, rawLine: string) => void;
  private onRawLine?: (rawLine: string) => void;
  private onError?: (error: Error, rawLine: string) => void;

  constructor(options: JsonlParserOptions = {}) {
    this.onEvent = options.onEvent;
    this.onRawLine = options.onRawLine;
    this.onError = options.onError;
  }

  /**
   * Feed a chunk of string/buffer data into the parser
   */
  public feed(chunk: string | Buffer): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this.buffer += text;

    const lines = this.buffer.split('\n');
    // Keep the last incomplete fragment in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      this.processLine(line);
    }
  }

  /**
   * Flush any remaining buffered content
   */
  public flush(): void {
    if (this.buffer.trim().length > 0) {
      this.processLine(this.buffer);
      this.buffer = '';
    }
  }

  private processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    this.onRawLine?.(trimmed);

    try {
      const parsed = JSON.parse(trimmed);
      this.onEvent?.(parsed, trimmed);
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)), trimmed);
    }
  }
}

/**
 * Parse an entire JSONL string into an array of parsed objects
 */
export function parseJsonlString<T = unknown>(content: string): { events: T[]; errors: { line: string; error: Error }[] } {
  const events: T[] = [];
  const errors: { line: string; error: Error }[] = [];

  const parser = new JsonlParser({
    onEvent: (evt) => events.push(evt as T),
    onError: (err, line) => errors.push({ line, error: err }),
  });

  parser.feed(content);
  parser.flush();

  return { events, errors };
}
