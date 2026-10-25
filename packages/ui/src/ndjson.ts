import type { ApiErrorBody } from '@kedalion/server-core/protocol';

// Reads the NDJSON streams of server-core's `ndjson()`; no DOM or runtime imports, so tests can use it.

/** A `$error` line from the server, or a line that isn't JSON (code 'badStream'). */
export class NdjsonError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
  }
}

/**
 * Calls `onItem` for each line of `body` until the `{"$end":true}` line: resolves `{ end: true }`
 * there, `{ end: false }` when the body ends without it. Throws NdjsonError on a `$error` line.
 */
export async function readNdjson(body: ReadableStream<Uint8Array>, onItem: (item: unknown) => void): Promise<{ end: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // true when the stream is over ($end); throws on $error or a bad line.
  const handle = (text: string): boolean => {
    if (!text.trim()) return false;
    let item: any;
    try {
      item = JSON.parse(text);
    } catch {
      throw new NdjsonError({ kind: 'internal', code: 'badStream', message: 'The server sent an invalid stream.' });
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (item.$end === true) return true;
      if ('$error' in item) throw new NdjsonError(item.$error);
    }
    onItem(item);
    return false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = done ? '' : parts.pop()!;
      for (const part of parts) if (handle(part)) return { end: true };
      if (done) return { end: false };
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
