import { AppError } from './errors.ts';
import type { ApiErrorBody } from './protocol.ts';

export type Emit = (item: unknown) => Promise<void>;

const encoder = new TextEncoder();
const line = (value: unknown) => encoder.encode(JSON.stringify(value) + '\n');

/**
 * Streams `produce`'s items as NDJSON, one JSON value per line. The body is pull-based: `emit`
 * resolves once the consumer has room, so a fast producer doesn't buffer without bound.
 * `signal` aborts when the request is aborted or the stream is cancelled; `emit` is then a no-op,
 * so loops in `produce` should check `signal.aborted`.
 * The last line is `{"$end":true}`, or `{"$error": ApiErrorBody}` when `produce` throws.
 */
export function ndjson(req: Request, produce: (emit: Emit, signal: AbortSignal) => Promise<void>): Response {
  const abort = new AbortController();
  const signal = abort.signal;
  const stop = () => abort.abort();
  if (req.signal.aborted) stop();
  else req.signal.addEventListener('abort', stop, { once: true });

  // Resolves the pending emit when the consumer pulls (or the stream goes away).
  let waiters: Array<() => void> = [];
  const release = () => {
    const ws = waiters;
    waiters = [];
    for (const w of ws) w();
  };
  signal.addEventListener('abort', release, { once: true });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: Emit = async (item) => {
        if (signal.aborted) return;
        while ((controller.desiredSize ?? 0) <= 0 && !signal.aborted) {
          await new Promise<void>((resolve) => { waiters.push(resolve); });
        }
        if (!signal.aborted) controller.enqueue(line(item));
      };
      const finish = (last: unknown) => {
        req.signal.removeEventListener('abort', stop);
        if (signal.aborted) return;
        controller.enqueue(line(last));
        controller.close();
      };
      // Not awaited: start() must return so the stream can be read while produce runs.
      Promise.resolve().then(() => produce(emit, signal)).then(
        () => finish({ $end: true }),
        (err) => finish({ $error: errorBody(err) }),
      );
    },
    pull() {
      release();
    },
    cancel() {
      stop();
    },
  }, { highWaterMark: 16 });

  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function errorBody(err: unknown): ApiErrorBody {
  if (err instanceof AppError) return err.toJSON();
  console.error(err);
  return { kind: 'internal', code: 'raw', message: String((err as Error)?.message ?? err), detail: '', params: {} };
}
