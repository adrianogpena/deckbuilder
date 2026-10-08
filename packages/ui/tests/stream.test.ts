import { expect, test } from 'bun:test';
import { NdjsonError, readNdjson } from '../src/ndjson.ts';

const body = (...chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) {
    for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
    c.close();
  },
});

async function read(...chunks: string[]) {
  const items: unknown[] = [];
  const result = await readNdjson(body(...chunks), (item) => items.push(item));
  return { items, ...result };
}

test('readNdjson joins a line split over two chunks and splits two lines in one chunk', async () => {
  expect(await read('{"a":', '1}\n{"b":2}\n{"c":3}\n', '{"$end":true}\n')).toEqual({ items: [{ a: 1 }, { b: 2 }, { c: 3 }], end: true });
});

test('readNdjson decodes a multi-byte character split between chunks', async () => {
  const bytes = new TextEncoder().encode('"ação"\n{"$end":true}\n');
  const s = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, 3));
      c.enqueue(bytes.slice(3));
      c.close();
    },
  });
  const items: unknown[] = [];
  expect(await readNdjson(s, (i) => items.push(i))).toEqual({ end: true });
  expect(items).toEqual(['ação']);
});

test('readNdjson reports a body that ends without $end, and a last line without newline', async () => {
  expect(await read('1\n2')).toEqual({ items: [1, 2], end: false });
});

test('readNdjson throws the $error body and badStream for a bad line', async () => {
  const error = { kind: 'invalid', code: 'badPath', message: 'Invalid path.' };
  const failed = await read(`1\n{"$error":${JSON.stringify(error)}}\n`).catch((e) => e);
  expect(failed).toBeInstanceOf(NdjsonError);
  expect(failed.body).toEqual(error);
  const bad = await read('{oops\n').catch((e) => e);
  expect(bad.body.code).toBe('badStream');
});
