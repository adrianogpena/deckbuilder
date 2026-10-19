import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewStore, toReviewState } from './review.ts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'review-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

test('a missing file reads as an empty review', async () => {
  expect(await createReviewStore(dir).read('C:/p')).toEqual({ viewed: [], comments: [], summary: '' });
});

test('write then read keeps viewed files, comments and summary per project', async () => {
  const store = createReviewStore(dir);
  const state = { viewed: ['a.ts'], comments: [{ id: 'c1', path: 'a.ts', line: 3, text: 'rename' }, { id: 'c2', path: 'b.ts', line: 1, removed: true, text: 'why' }], summary: 'ok' };
  expect(await store.write('C:/p', state)).toBe(true);
  expect(await store.read('C:/p')).toEqual(state);
  expect(await store.read('C:/other')).toEqual({ viewed: [], comments: [], summary: '' });
});

test('a bad shape is refused and a bad file reads as empty', async () => {
  const store = createReviewStore(dir);
  expect(await store.write('C:/p', { viewed: [], comments: [{ id: 'a', path: 'x', line: 1.5, text: '' }], summary: '' })).toBe(false);
  expect(toReviewState({ viewed: [1], comments: [], summary: '' })).toBeUndefined();
  await writeFile(store.fileOf('C:/p'), '{ nope');
  expect(await store.read('C:/p')).toEqual({ viewed: [], comments: [], summary: '' });
});
