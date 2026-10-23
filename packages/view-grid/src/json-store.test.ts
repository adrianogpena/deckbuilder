import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonStore } from './json-store.ts';

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});

const make = async () => {
  dir = await mkdtemp(join(tmpdir(), 'jstore-'));
  return createJsonStore<{ n: number }>({
    dataDir: dir,
    name: 'counter',
    parse: (raw) => ({ n: Number((raw as { n?: unknown })?.n) || 0 }),
    empty: () => ({ n: 0 }),
  });
};

describe('createJsonStore', () => {
  test('reads empty when the file is missing', async () => {
    const store = await make();
    expect(await store.read()).toEqual({ n: 0 });
  });

  test('serializes concurrent updates and persists them', async () => {
    const store = await make();
    await Promise.all(Array.from({ length: 10 }, () => store.update((v) => ({ n: v.n + 1 }))));
    expect(await store.read()).toEqual({ n: 10 });
    expect(JSON.parse(await readFile(join(dir, 'grid', 'counter.json'), 'utf8'))).toEqual({ n: 10 });
  });

  test('unreadable JSON reads as empty', async () => {
    const store = await make();
    await mkdir(join(dir, 'grid'), { recursive: true });
    await writeFile(join(dir, 'grid', 'counter.json'), '{nope');
    expect(await store.read()).toEqual({ n: 0 });
  });
});
