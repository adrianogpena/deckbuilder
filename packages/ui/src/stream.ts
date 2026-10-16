import { TOKEN_HEADER } from '@deckbuilderkit/server-core/protocol';
import { type QueryParams, qs, RequestError } from './api-core';
import { session } from './api';
import { NdjsonError, readNdjson } from './ndjson';

export { NdjsonError, readNdjson } from './ndjson';

/**
 * GETs an NDJSON route (server-core's `ndjson()`) and calls `onItem` for each item. Resolves at the
 * stream's `$end`; rejects RequestError with the server's error, `streamClosed` when the stream
 * ends early, `badStream` on a bad line, or the abort reason when `signal` aborts.
 */
export async function stream(path: string, params: QueryParams, onItem: (item: unknown) => void, signal?: AbortSignal): Promise<void> {
  const token = await session;
  signal?.throwIfAborted();
  let res: Response;
  try {
    res = await fetch(path + qs(params), { headers: { [TOKEN_HEADER]: token }, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new RequestError({ kind: 'offline', code: 'offline', message: 'The app server is not responding.' });
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new RequestError(data ?? { kind: 'internal', code: 'http', params: { status: res.status }, message: `HTTP error ${res.status}` });
  }
  let end: boolean;
  try {
    ({ end } = await readNdjson(res.body, onItem));
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof NdjsonError) throw new RequestError(err.body);
    throw closed();
  }
  if (!end) throw closed();
}

const closed = () => new RequestError({ kind: 'offline', code: 'streamClosed', message: 'The stream ended before it was complete.' });
