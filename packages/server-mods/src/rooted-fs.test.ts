import { afterEach, expect, test } from 'bun:test';
import { symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformError } from '@deckbuilder/platform';
import type { RouteContext } from '@deckbuilder/server-core';
import { type FsEntry, rootedFs, searchTree } from './rooted-fs.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const OLD = new Date('2020-01-01T00:00:00Z');

async function setup(opts: { maxReadBytes?: number } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'deckbuilder-fs-'));
  dirs.push(base);
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  await mkdir(join(root, 'a'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'a', 'b.txt'), 'hello\nsecond line');
  await utimes(join(root, 'a', 'b.txt'), OLD, OLD);
  await writeFile(join(root, 'top.txt'), 'top');
  await writeFile(join(outside, 'secret.txt'), 'secret');
  symlinkSync(outside, join(root, 'link'), 'junction');
  const trashed: string[][] = [];
  const fs = rootedFs({
    roots: async () => [
      { id: 'r', path: root },
      { id: 'ro', path: root, readOnly: true },
    ],
    trash: async (paths) => {
      trashed.push(paths);
    },
    ...opts,
  });
  const call = async (key: string, input: string | Record<string, unknown>) => {
    const ctx = {
      req: new Request('http://x/'),
      query: new URLSearchParams(typeof input === 'string' ? input : ''),
      json: async () => input,
    } as unknown as RouteContext;
    return fs.routes[key]!(ctx);
  };
  const fail = (key: string, input: string | Record<string, unknown>) => call(key, input).catch((e) => e);
  return { root, realRoot: await realpath(root), fs, call, fail, trashed };
}

const lines = async (res: unknown) => (await (res as Response).text()).trim().split('\n').map((l) => JSON.parse(l));

const ESCAPES = ['../x', 'a/../../x', 'C:\\x', '\\\\srv\\s', '/x', 'CON', 'con.txt', 'a:b', 'x.'];

test('resolve refuses escapes and odd names, accepts paths inside the root', async () => {
  const { fs, realRoot } = await setup();
  for (const rel of ESCAPES) expect(await fs.resolve('r', rel).catch((e) => e)).toMatchObject({ kind: 'invalid', code: 'badPath' });
  expect(await fs.resolve('r', 'link/secret.txt').catch((e) => e)).toMatchObject({ kind: 'forbidden', code: 'outsideRoot', status: 403 });
  expect(await fs.resolve('r', 'link').catch((e) => e)).toMatchObject({ code: 'outsideRoot' });

  expect((await fs.resolve('r', 'a/b.txt')).real).toBe(join(realRoot, 'a', 'b.txt'));
  expect((await fs.resolve('r', 'a\\.\\b.txt')).real).toBe(join(realRoot, 'a', 'b.txt'));
  expect(await fs.resolve('r', '')).toMatchObject({ abs: realRoot, real: realRoot, root: { id: 'r' } });
  expect((await fs.resolve('r', 'new/dir/file.txt')).real).toBe(join(realRoot, 'new', 'dir', 'file.txt'));
  expect(await fs.resolve('r', 'new/file.txt', { mustExist: true }).catch((e) => e)).toMatchObject({ code: 'fileNotFound' });
  expect(await fs.resolve('nope', '').catch((e) => e)).toMatchObject({ kind: 'notfound', code: 'rootNotFound' });
});

test('a dangling link is refused: where it points cannot be checked', async () => {
  const { root, fs } = await setup();
  symlinkSync(join(root, '..', 'outside', 'gone'), join(root, 'dangling'), 'junction');
  expect(await fs.resolve('r', 'dangling/new.txt').catch((e) => e)).toMatchObject({ code: 'outsideRoot' });
});

test('list puts folders first and marks links that leave the root', async () => {
  const { root, call } = await setup();
  symlinkSync(join(root, 'a'), join(root, 'a-link'), 'junction');
  const { entries } = (await call('GET /api/fs/list', 'root=r')) as { entries: FsEntry[] };
  expect(entries.map(({ name, kind, outside, target }) => ({ name, kind, outside, target }))).toEqual([
    { name: 'a', kind: 'dir', outside: undefined, target: undefined },
    { name: 'a-link', kind: 'link', outside: undefined, target: 'dir' },
    { name: 'link', kind: 'link', outside: true, target: undefined },
    { name: 'top.txt', kind: 'file', outside: undefined, target: undefined },
  ]);
  expect(entries[3]).toMatchObject({ size: 3, mtime: expect.any(Number) });
  expect(await call('GET /api/fs/stat', 'root=r&path=a/b.txt')).toEqual({ name: 'b.txt', kind: 'file', size: 17, mtime: OLD.getTime() });
});

test('read gives text, truncated text or binary', async () => {
  const { root, call } = await setup({ maxReadBytes: 3 });
  expect(await call('GET /api/fs/read', 'root=r&path=top.txt')).toEqual({ text: 'top', size: 3, mtime: expect.any(Number), truncated: false });
  expect(await call('GET /api/fs/read', 'root=r&path=a/b.txt')).toMatchObject({ text: 'hel', size: 17, truncated: true });
  await writeFile(join(root, 'bin.dat'), new Uint8Array([1, 0, 2]));
  expect(await call('GET /api/fs/read', 'root=r&path=bin.dat')).toMatchObject({ binary: true, size: 3 });
});

test('raw serves the bytes with a type by extension and nosniff', async () => {
  const { call, fail } = await setup();
  const res = (await call('GET /api/fs/raw', 'root=r&path=top.txt')) as Response;
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await res.text()).toBe('top');
  expect(await fail('GET /api/fs/raw', 'root=r&path=a')).toMatchObject({ code: 'notAFile' });
});

test('write checks the mtime, creates new files and needs the parent', async () => {
  const { root, call, fail } = await setup();
  const entry = (await call('POST /api/fs/write', { root: 'r', path: 'a/b.txt', text: 'bye', expectedMtime: OLD.getTime() })) as FsEntry;
  expect(entry).toMatchObject({ name: 'b.txt', kind: 'file', size: 3 });
  expect(await readFile(join(root, 'a', 'b.txt'), 'utf8')).toBe('bye');
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'a/b.txt', text: 'x', expectedMtime: OLD.getTime() })).toMatchObject({
    code: 'fileChanged',
  });
  await call('POST /api/fs/write', { root: 'r', path: 'a/new.txt', text: 'n' });
  expect(await readFile(join(root, 'a', 'new.txt'), 'utf8')).toBe('n');
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'missing/x.txt', text: 'x' })).toMatchObject({ code: 'fileNotFound' });
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'a', text: 'x' })).toMatchObject({ code: 'notAFile' });
});

test('create, rename and move', async () => {
  const { root, call, fail } = await setup();
  await call('POST /api/fs/create', { root: 'r', path: 'a/c.txt', kind: 'file', text: 'c' });
  expect(await fail('POST /api/fs/create', { root: 'r', path: 'a/c.txt', kind: 'file' })).toMatchObject({ code: 'exists' });
  expect(await call('POST /api/fs/create', { root: 'r', path: 'd/e', kind: 'dir' })).toMatchObject({ name: 'e', kind: 'dir' });
  expect(await fail('POST /api/fs/create', { root: 'r', path: 'd/e', kind: 'dir' })).toMatchObject({ code: 'exists' });

  expect(await call('POST /api/fs/rename', { root: 'r', path: 'a/c.txt', name: 'c2.txt' })).toMatchObject({ name: 'c2.txt' });
  expect(await readFile(join(root, 'a', 'c2.txt'), 'utf8')).toBe('c');
  expect(await fail('POST /api/fs/rename', { root: 'r', path: 'a/c2.txt', name: 'x/y' })).toMatchObject({ code: 'badPath' });
  expect(await fail('POST /api/fs/rename', { root: 'r', path: 'a/c2.txt', name: '..' })).toMatchObject({ code: 'badPath' });
  expect(await fail('POST /api/fs/rename', { root: 'r', path: 'a/c2.txt', name: 'b.txt' })).toMatchObject({ code: 'exists' });
  expect(await fail('POST /api/fs/rename', { root: 'r', path: '', name: 'x' })).toMatchObject({ code: 'badPath' });

  expect(await call('POST /api/fs/move', { root: 'r', from: 'a/c2.txt', to: 'd/c2.txt' })).toMatchObject({ name: 'c2.txt', kind: 'file' });
  expect(await readFile(join(root, 'd', 'c2.txt'), 'utf8')).toBe('c');
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'd', to: 'd/e/d' })).toMatchObject({ code: 'moveIntoSelf' });
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'd/c2.txt', to: 'a/b.txt' })).toMatchObject({ code: 'exists' });
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'gone.txt', to: 'a/x.txt' })).toMatchObject({ code: 'fileNotFound' });
});

test('delete hands the real paths to the trash in one call', async () => {
  const { realRoot, call, fail, trashed } = await setup();
  expect(await call('POST /api/fs/delete', { root: 'r', paths: ['a/b.txt', 'top.txt', 'a', 'top.txt'] })).toEqual({ ok: true });
  expect(trashed).toEqual([[join(realRoot, 'top.txt'), join(realRoot, 'a')]]);
  expect(await fail('POST /api/fs/delete', { root: 'r', paths: [''] })).toMatchObject({ code: 'badPath' });
  expect(await fail('POST /api/fs/delete', { root: 'r', paths: [] })).toMatchObject({ code: 'badRequest' });
  expect(await fail('POST /api/fs/delete', { root: 'r', paths: Array(1001).fill('top.txt') })).toMatchObject({ code: 'tooManyItems' });
});

test('a trash failure reaches the client as its PlatformError code', async () => {
  const base = await mkdtemp(join(tmpdir(), 'deckbuilder-fs-'));
  dirs.push(base);
  await writeFile(join(base, 'f.txt'), 'x');
  const fs = rootedFs({
    roots: async () => [{ id: 'r', path: base }],
    trash: async () => {
      throw new PlatformError('trashFailed', 'nope', 'detail');
    },
  });
  const ctx = { json: async () => ({ root: 'r', paths: ['f.txt'] }) } as unknown as RouteContext;
  expect(await Promise.resolve(fs.routes['POST /api/fs/delete']!(ctx)).catch((e) => e)).toMatchObject({ code: 'trashFailed', opts: { detail: 'detail' } });
});

test('every route refuses escapes', async () => {
  const { fail, trashed } = await setup();
  for (const [rel, code] of [
    ['../x', 'badPath'],
    ['link/secret.txt', 'outsideRoot'],
  ] as const) {
    const q = `root=r&path=${encodeURIComponent(rel)}`;
    for (const key of ['GET /api/fs/list', 'GET /api/fs/stat', 'GET /api/fs/read', 'GET /api/fs/raw', 'GET /api/fs/search']) {
      expect(await fail(key, q)).toMatchObject({ code });
    }
    expect(await fail('POST /api/fs/write', { root: 'r', path: rel, text: 'x' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/create', { root: 'r', path: rel, kind: 'file' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/rename', { root: 'r', path: rel, name: 'y' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/move', { root: 'r', from: rel, to: 'a/y' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/move', { root: 'r', from: 'top.txt', to: rel })).toMatchObject({ code });
    expect(await fail('POST /api/fs/delete', { root: 'r', paths: ['top.txt', rel] })).toMatchObject({ code });
  }
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'top.txt', to: 'a/top.txt', toRoot: 'nope' })).toMatchObject({ code: 'rootNotFound' });
  expect(trashed).toEqual([]);
});

test('a read-only root refuses every write', async () => {
  const { fail, trashed } = await setup();
  for (const [key, body] of [
    ['POST /api/fs/write', { path: 'top.txt', text: 'x' }],
    ['POST /api/fs/create', { path: 'n.txt', kind: 'file' }],
    ['POST /api/fs/rename', { path: 'top.txt', name: 'y.txt' }],
    ['POST /api/fs/move', { from: 'top.txt', to: 'a/top.txt' }],
    ['POST /api/fs/delete', { paths: ['top.txt'] }],
  ] as const) {
    expect(await fail(key, { root: 'ro', ...body })).toMatchObject({ kind: 'forbidden', code: 'rootReadOnly' });
  }
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'top.txt', to: 'a/top.txt', toRoot: 'ro' })).toMatchObject({ code: 'rootReadOnly' });
  expect(trashed).toEqual([]);
});

test('search streams name and content hits, never through links', async () => {
  const { root, call } = await setup();
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'node_modules', 'b-hello.txt'), 'hello');
  expect(await lines(await call('GET /api/fs/search', 'root=r&q=B'))).toEqual([{ path: 'a/b.txt', kind: 'file' }, { $end: true }]);
  expect(await lines(await call('GET /api/fs/search', 'root=r&q=line&content=1'))).toEqual([
    { path: 'a/b.txt', kind: 'file', line: 2, text: 'second line' },
    { $end: true },
  ]);
  expect(await lines(await call('GET /api/fs/search', 'root=r&path=a&q=&glob=*.txt'))).toEqual([{ path: 'a/b.txt', kind: 'file' }, { $end: true }]);
  expect(await lines(await call('GET /api/fs/search', 'root=r&q=secret&content=1'))).toEqual([{ $end: true }]);
});

test('search stops once aborted', async () => {
  const { root } = await setup();
  for (let i = 0; i < 10; i++) await writeFile(join(root, `hit${i}.txt`), 'x');
  const ac = new AbortController();
  const hits = searchTree({ abs: root, rel: '' }, { q: 'hit', content: false, glob: null }, ac.signal);
  expect((await hits.next()).value).toEqual({ path: 'hit0.txt', kind: 'file' });
  ac.abort();
  expect((await hits.next()).done).toBe(true);
});
