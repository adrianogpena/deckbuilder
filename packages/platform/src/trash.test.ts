import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformError } from './errors.ts';
import { moveToTrash, type TrashDeps } from './trash.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeTrash(failOn?: string) {
  const calls: string[] = [];
  const deps: TrashDeps = {
    trashOne: async (path) => {
      calls.push(path);
      if (path === failOn) throw new PlatformError('trashFailed', 'nope', 'boom');
    },
  };
  return { calls, deps };
}

test('one awaited call per path, in order; no paths do nothing', async () => {
  const { calls, deps } = fakeTrash();
  await moveToTrash(['C:\\x\\a', 'C:\\x\\b', 'C:\\x\\c'], deps);
  expect(calls).toEqual(['C:\\x\\a', 'C:\\x\\b', 'C:\\x\\c']);
  await moveToTrash([], deps);
  expect(calls).toHaveLength(3);
});

test('stops at the first failure and says which paths were and were not moved', async () => {
  const { calls, deps } = fakeTrash('b');
  const err = await moveToTrash(['a', 'b', 'c'], deps).catch((e) => e);
  expect(err).toMatchObject({ code: 'trashFailed' });
  expect(err.detail).toContain('boom');
  expect(err.detail).toContain('Moved: a');
  expect(err.detail).toContain('Not moved: b, c');
  expect(calls).toEqual(['a', 'b']);
});

test('a single failing path keeps its own error', async () => {
  expect(await moveToTrash(['b'], fakeTrash('b').deps).catch((e) => e)).toMatchObject({ code: 'trashFailed', detail: 'boom' });
});

test.skipIf(process.platform !== 'win32')('files and folders end up gone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kedalion-trash-'));
  dirs.push(dir);
  const file = join(dir, 'ção.txt');
  const folder = join(dir, 'folder');
  await writeFile(file, 'x');
  await mkdir(folder);
  await writeFile(join(folder, 'inner.txt'), 'y');
  await moveToTrash([file]);
  await moveToTrash([folder]);
  expect(await Bun.file(file).exists()).toBe(false);
  expect(await Bun.file(join(folder, 'inner.txt')).exists()).toBe(false);
});
