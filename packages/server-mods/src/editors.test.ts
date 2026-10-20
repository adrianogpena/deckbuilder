import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EditorId, findEditor, openInEditor } from '@deckbuilderkit/platform';
import type { RouteContext } from '@deckbuilderkit/server-core';
import { pickedPaths } from './dialogs.ts';
import { editorRoutes } from './editors.ts';
import { rootedFs } from './rooted-fs.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Opened {
  id: EditorId;
  exe: string;
  folder: string;
  file?: string;
  line?: number;
}

async function setup(over: { detected?: Partial<Record<EditorId, string>>; picked?: string | null } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'deckbuilder-editors-'));
  dirs.push(base);
  const root = join(base, 'root');
  await mkdir(join(root, 'sub'), { recursive: true });
  await writeFile(join(root, 'sub', 'a.ts'), 'x');
  const fs = rootedFs({ roots: async () => [{ id: 'r', path: root }] });
  const opened: Opened[] = [];
  const find = (async (id: EditorId) => over.detected?.[id] ?? null) as typeof findEditor;
  const picked = pickedPaths();
  if (over.picked) picked.add(over.picked);
  const open = (async (id: EditorId, exe: string, o: { folder: string; file?: string; line?: number }) => {
    opened.push({ id, exe, ...o });
  }) as typeof openInEditor;
  const routes = editorRoutes({ dir: join(base, 'home'), fs, picked, find, open });
  const call = (key: string, input: Record<string, unknown> = {}, query = '') =>
    routes[key]!({ query: new URLSearchParams(query), json: async () => input } as unknown as RouteContext);
  const fail = (key: string, input: Record<string, unknown> = {}, query = '') => Promise.resolve(call(key, input, query)).catch((e) => e);
  return { realRoot: await realpath(root), call, fail, opened };
}

test('open passes the real folder and file', async () => {
  const { realRoot, call, opened } = await setup({ detected: { vscode: 'Code.exe' } });
  expect(await call('POST /api/editors/open', { editor: 'vscode', root: 'r', path: 'sub/a.ts', line: 3 })).toEqual({ ok: true });
  expect(opened).toEqual([{ id: 'vscode', exe: 'Code.exe', folder: realRoot, file: join(realRoot, 'sub', 'a.ts'), line: 3 }]);
});

test('a folder path opens only the project root', async () => {
  const { realRoot, call, opened } = await setup({ detected: { intellij: 'idea64.exe' } });
  await call('POST /api/editors/open', { editor: 'intellij', root: 'r', path: 'sub' });
  expect(opened).toEqual([{ id: 'intellij', exe: 'idea64.exe', folder: realRoot, file: undefined, line: undefined }]);
});

test('a path outside the root is refused before open runs', async () => {
  const { fail, opened } = await setup({ detected: { vscode: 'Code.exe' } });
  expect(await fail('POST /api/editors/open', { editor: 'vscode', root: 'r', path: '../x' })).toMatchObject({ code: 'badPath' });
  expect(await fail('POST /api/editors/open', { editor: 'vscode', root: 'r', path: 'sub/../../x' })).toMatchObject({ code: 'badPath' });
  expect(opened).toEqual([]);
});

test('no program gives editorNotFound; bad input is refused', async () => {
  const { fail, opened } = await setup();
  expect(await fail('POST /api/editors/open', { editor: 'vscode', root: 'r' })).toMatchObject({ code: 'editorNotFound' });
  expect(await fail('POST /api/editors/open', { editor: 'emacs', root: 'r' })).toMatchObject({ code: 'badEditor' });
  expect(await fail('POST /api/editors/open', { editor: 'vscode', root: 'r', line: 0 })).toMatchObject({ code: 'badRequest' });
  expect(opened).toEqual([]);
});

test('pick stores an override that the list returns as custom; delete removes it', async () => {
  const exe = join(tmpdir(), 'my-editor.exe');
  const { call } = await setup({ detected: { vscode: 'Code.exe' }, picked: exe });
  const before = (await call('GET /api/editors')) as Array<{ id: string; path: string | null; custom: boolean }>;
  expect(before.find((e) => e.id === 'vscode')).toMatchObject({ path: 'Code.exe', custom: false });
  expect(before.find((e) => e.id === 'intellij')).toMatchObject({ path: null, custom: false });
  const after = (await call('POST /api/editors/pick', { editor: 'vscode', path: exe })) as typeof before;
  expect(after.find((e) => e.id === 'vscode')).toMatchObject({ path: exe, custom: true });
  const reset = (await call('DELETE /api/editors/override', {}, 'editor=vscode')) as typeof before;
  expect(reset.find((e) => e.id === 'vscode')).toMatchObject({ path: 'Code.exe', custom: false });
});

test('pick of a script is refused on Windows', async () => {
  if (process.platform !== 'win32') return;
  const script = join(tmpdir(), 'x.cmd');
  const { fail } = await setup({ picked: script });
  expect(await fail('POST /api/editors/pick', { editor: 'vscode', path: script })).toMatchObject({ code: 'editorNotExe' });
});

test('pick refuses a path the dialog did not commit', async () => {
  const { fail } = await setup();
  expect(await fail('POST /api/editors/pick', { editor: 'vscode', path: join(tmpdir(), 'x.exe') })).toMatchObject({ code: 'notAPickedFile' });
});
