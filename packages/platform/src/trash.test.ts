import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveToTrash, type TrashDeps, trashScript } from './trash.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeSpawn(code: number, stderr = '') {
  const calls: Array<{ script: string; stdin: string }> = [];
  const deps: TrashDeps = {
    spawn: (script) => {
      const call = { script, stdin: '' };
      calls.push(call);
      return {
        pid: 0,
        stdin: { write: (data: string) => (call.stdin += data), end: () => {} },
        stderr: new Response(stderr).body!,
        exited: Promise.resolve(code),
      };
    },
  };
  return { calls, deps };
}

test('the script recycles and reads the paths from stdin only', async () => {
  expect(trashScript()).toContain('FOF_ALLOWUNDO');
  expect(trashScript()).toContain('FOF_WANTNUKEWARNING');
  const { calls, deps } = fakeSpawn(0);
  const paths = [`C:\\x\\a'b";$(evil).txt`, 'C:\\x\\ção'];
  await moveToTrash(paths, deps);
  expect(calls[0]!.script).not.toContain('evil');
  expect(calls[0]!.stdin).not.toContain('ç');
  expect(JSON.parse(calls[0]!.stdin)).toEqual({ paths });
});

test('a failing host gives trashFailed with its stderr; no paths spawn nothing', async () => {
  expect(await moveToTrash(['C:\\x'], fakeSpawn(1, 'boom\n').deps).catch((e) => e)).toMatchObject({ code: 'trashFailed', detail: 'boom' });
  const { calls, deps } = fakeSpawn(0);
  await moveToTrash([], deps);
  expect(calls).toHaveLength(0);
});

test.skipIf(process.platform !== 'win32')('files and folders end up gone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckbuilder-trash-'));
  dirs.push(dir);
  const file = join(dir, 'ção.txt');
  const folder = join(dir, 'folder');
  await writeFile(file, 'x');
  await mkdir(folder);
  await writeFile(join(folder, 'inner.txt'), 'y');
  await moveToTrash([file, folder]);
  expect(await Bun.file(file).exists()).toBe(false);
  expect(await Bun.file(join(folder, 'inner.txt')).exists()).toBe(false);
});
