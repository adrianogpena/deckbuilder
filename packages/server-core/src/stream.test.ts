import { afterEach, expect, test } from 'bun:test';
import { invalid } from './errors.ts';
import { ndjson } from './stream.ts';

const lines = async (res: Response) => (await res.text()).trim().split('\n').map((l) => JSON.parse(l));

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

test('ndjson writes items in order, then $end', async () => {
  const res = ndjson(new Request('http://x/'), async (emit) => {
    for (let i = 0; i < 40; i++) await emit({ i });
  });
  expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
  expect(res.headers.get('cache-control')).toBe('no-store');
  const out = await lines(res);
  expect(out.slice(0, -1)).toEqual(Array.from({ length: 40 }, (_, i) => ({ i })));
  expect(out.at(-1)).toEqual({ $end: true });
});

test('ndjson survives more concurrent emits than the high-water mark', async () => {
  const res = ndjson(new Request('http://x/'), async (emit) => {
    await Promise.all(Array.from({ length: 100 }, (_, i) => emit({ i })));
  });
  const out = await lines(res);
  expect(out).toHaveLength(101);
  expect(out.at(-1)).toEqual({ $end: true });
});

test('ndjson ends with $error for an AppError and for other errors', async () => {
  const app = await lines(ndjson(new Request('http://x/'), async (emit) => {
    await emit(1);
    throw invalid('badPath', 'Invalid path.', { path: 'a' });
  }));
  expect(app).toEqual([1, { $error: { kind: 'invalid', code: 'badPath', message: 'Invalid path.', detail: '', params: { path: 'a' } } }]);

  const origError = console.error;
  console.error = () => {};
  const other = await lines(ndjson(new Request('http://x/'), async () => { throw new Error('boom'); }));
  console.error = origError;
  expect(other).toEqual([{ $error: { kind: 'internal', code: 'raw', message: 'boom', detail: '', params: {} } }]);
});

test('aborting the request aborts produce and makes emit a no-op', async () => {
  const ac = new AbortController();
  let done!: (aborted: boolean) => void;
  const finished = new Promise<boolean>((r) => { done = r; });
  const res = ndjson(new Request('http://x/', { signal: ac.signal }), async (emit, signal) => {
    let n = 0;
    while (!signal.aborted) await emit(n++);
    await emit('after');
    done(signal.aborted);
  });
  const reader = res.body!.getReader();
  await reader.read();
  ac.abort();
  expect(await finished).toBe(true);
});

test('a client abort over Bun.serve fires req.signal and stops produce', async () => {
  let reqAborted!: () => void;
  const reqSignalFired = new Promise<void>((r) => { reqAborted = r; });
  let done!: () => void;
  const produceStopped = new Promise<void>((r) => { done = r; });
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      req.signal.addEventListener('abort', () => reqAborted());
      return ndjson(req, async (emit, signal) => {
        let n = 0;
        while (!signal.aborted) {
          await emit({ n: n++ });
          await Bun.sleep(5);
        }
        done();
      });
    },
  });
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}/`, { signal: ac.signal });
  const reader = res.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toStartWith('{"n":0}');
  ac.abort();
  await reqSignalFired;
  await produceStopped;
});
