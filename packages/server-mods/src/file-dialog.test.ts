import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppError, RouteContext } from '@kedalion/server-core';
import { pickedPaths } from './dialogs.ts';
import { FILE_DIALOG_MAX_ENTRIES, fileDialogRoutes } from './file-dialog.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'file-dialog-'));
  dirs.push(base);
  const home = join(base, 'app');
  const userHome = join(base, 'user');
  await mkdir(home);
  await mkdir(join(userHome, 'Documents'), { recursive: true });
  const picks = { opened: pickedPaths(), saveTargets: pickedPaths() };
  const routes = fileDialogRoutes({ home, picks, userHome });
  const call = (key: string, query: Record<string, string> = {}, body: unknown = {}) =>
    routes[key]!({ query: new URLSearchParams(query), json: async () => body } as unknown as RouteContext) as Promise<any>;
  return { base, home, userHome, picks, call };
}

test('lists folders first by name with sizes, parent and hidden flag', async () => {
  const { base, call } = await setup();
  await mkdir(join(base, 'zdir'));
  await writeFile(join(base, 'b.txt'), 'hello');
  await writeFile(join(base, 'a.txt'), '');
  await writeFile(join(base, '.hid'), '');
  const out = await call('GET /api/file-dialog/list', { path: base });
  expect(out.path).toBe(base);
  expect(out.parent).not.toBeNull();
  expect(out.truncated).toBe(false);
  expect(out.entries.map((e: any) => e.name)).toEqual(['app', 'user', 'zdir', '.hid', 'a.txt', 'b.txt']);
  expect(out.entries.find((e: any) => e.name === 'b.txt')).toMatchObject({ kind: 'file', size: 5 });
  expect(out.entries.find((e: any) => e.name === '.hid').hidden).toBe(true);
});

test('caps a listing and flags it truncated', async () => {
  const { base, call } = await setup();
  const big = join(base, 'big');
  await mkdir(big);
  await Promise.all(Array.from({ length: FILE_DIALOG_MAX_ENTRIES + 3 }, (_, i) => writeFile(join(big, `f${i}`), '')));
  const out = await call('GET /api/file-dialog/list', { path: big });
  expect(out.entries).toHaveLength(FILE_DIALOG_MAX_ENTRIES);
  expect(out.truncated).toBe(true);
});

test('list errors: relative, missing', async () => {
  const { base, call } = await setup();
  await expect(call('GET /api/file-dialog/list', { path: 'rel/dir' })).rejects.toMatchObject({ kind: 'invalid' });
  await expect(call('GET /api/file-dialog/list', { path: join(base, 'nope') })).rejects.toMatchObject({ kind: 'notfound' });
});

test('stat tells existence and kind', async () => {
  const { base, call } = await setup();
  await writeFile(join(base, 'f.txt'), '');
  expect(await call('GET /api/file-dialog/stat', { path: base })).toEqual({ exists: true, kind: 'dir' });
  expect(await call('GET /api/file-dialog/stat', { path: join(base, 'f.txt') })).toEqual({ exists: true, kind: 'file' });
  expect(await call('GET /api/file-dialog/stat', { path: join(base, 'x') })).toEqual({ exists: false });
});

test('places: start falls back from the request to the last folder to home', async () => {
  const { base, userHome, call } = await setup();
  const first = await call('GET /api/file-dialog/places', { purpose: 'p' });
  expect(first.start).toBe(userHome);
  expect(first.places.map((p: any) => p.id)).toEqual(['home', 'documents']);
  expect(first.drives.length).toBeGreaterThan(0);

  await call('POST /api/file-dialog/commit', {}, { mode: 'folder', path: join(base, 'app'), purpose: 'p' });
  expect((await call('GET /api/file-dialog/places', { purpose: 'p' })).start).toBe(join(base, 'app'));
  expect((await call('GET /api/file-dialog/places', { purpose: 'other' })).start).toBe(userHome);
  expect((await call('GET /api/file-dialog/places', { purpose: 'p', start: base })).start).toBe(base);
  expect((await call('GET /api/file-dialog/places', { purpose: 'p', start: join(base, 'gone') })).start).toBe(join(base, 'app'));
});

test('mkdir validates the name and refuses an existing folder', async () => {
  const { base, call } = await setup();
  const made = await call('POST /api/file-dialog/mkdir', {}, { parent: base, name: ' new ' });
  expect(made.path).toBe(join(base, 'new'));
  expect((await call('GET /api/file-dialog/stat', { path: made.path })).kind).toBe('dir');
  const again = (await call('POST /api/file-dialog/mkdir', {}, { parent: base, name: 'new' }).catch((e: AppError) => e)) as AppError;
  expect(again.code).toBe('exists');
  for (const name of ['', '  ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*', 'a?', 'a"', 'a<', 'a>', 'a|']) {
    await expect(call('POST /api/file-dialog/mkdir', {}, { parent: base, name })).rejects.toMatchObject({ kind: 'invalid' });
  }
  await expect(call('POST /api/file-dialog/mkdir', {}, { parent: 'rel', name: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
});

test('commit adds the path to the right set and keeps recents, deduped, max 10', async () => {
  const { base, home, picks, call } = await setup();
  const file = join(base, 'a.txt');
  await call('POST /api/file-dialog/commit', {}, { mode: 'open', path: file });
  expect(picks.opened.take(file)).toBe(true);
  expect(picks.saveTargets.take(file)).toBe(false);
  await call('POST /api/file-dialog/commit', {}, { mode: 'save', path: file });
  expect(picks.saveTargets.take(file)).toBe(true);

  await call('POST /api/file-dialog/commit', {}, { mode: 'folder', path: join(base, 'app') });
  expect(picks.opened.take(join(base, 'app'))).toBe(true);
  for (let i = 0; i < 12; i++) await call('POST /api/file-dialog/commit', {}, { mode: 'folder', path: join(base, `d${i}`) });
  await call('POST /api/file-dialog/commit', {}, { mode: 'folder', path: join(base, 'd5') });
  const saved = JSON.parse(await readFile(join(home, 'file-dialog.json'), 'utf8'));
  expect(saved.recents).toHaveLength(10);
  expect(saved.recents[0]).toBe(join(base, 'd5'));
  expect(new Set(saved.recents).size).toBe(10);
  expect((await call('GET /api/file-dialog/places')).recents).toEqual(saved.recents);

  await expect(call('POST /api/file-dialog/commit', {}, { mode: 'nope', path: file })).rejects.toMatchObject({ kind: 'invalid' });
  await expect(call('POST /api/file-dialog/commit', {}, { mode: 'open', path: 'rel' })).rejects.toMatchObject({ kind: 'invalid' });
});

test('a corrupt state file reads as empty', async () => {
  const { home, call } = await setup();
  await writeFile(join(home, 'file-dialog.json'), '{nope');
  expect((await call('GET /api/file-dialog/places')).recents).toEqual([]);
});
