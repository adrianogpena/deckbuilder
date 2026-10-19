import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScratchpadStore, toScratchpad } from './scratchpad.ts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scratchpad-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

test('a missing file reads as an empty scratchpad', async () => {
  expect(await createScratchpadStore(dir).read('C:/p')).toEqual({ notes: '', todos: [] });
});

test('write then read keeps notes and the order of to-dos', async () => {
  const store = createScratchpadStore(dir);
  const pad = { notes: '# hi', todos: [{ id: 'b', text: 'two', done: true }, { id: 'a', text: 'one', done: false }] };
  expect(await store.write('C:/p', pad)).toBe(true);
  expect(await store.read('C:/p')).toEqual(pad);
  expect(await store.read('C:/other')).toEqual({ notes: '', todos: [] });
});

test('a bad shape is refused and a bad file reads as empty', async () => {
  const store = createScratchpadStore(dir);
  expect(await store.write('C:/p', { notes: 1, todos: [] })).toBe(false);
  expect(toScratchpad({ notes: '', todos: [{ id: 'a', text: 'x' }] })).toBeUndefined();
  await writeFile(store.fileOf('C:/p'), '{ nope');
  expect(await store.read('C:/p')).toEqual({ notes: '', todos: [] });
});
