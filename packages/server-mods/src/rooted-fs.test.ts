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

test('copy', async () => {
  const { root, call, fail } = await setup();
  await call('POST /api/fs/create', { root: 'r', path: 'a/c.txt', kind: 'file', text: 'c' });
  expect(await call('POST /api/fs/copy', { root: 'r', from: 'a/c.txt', to: 'a/c.txt' })).toMatchObject({ name: 'c copy.txt' });
  expect(await call('POST /api/fs/copy', { root: 'r', from: 'a/c.txt', to: 'a/c.txt' })).toMatchObject({ name: 'c copy 2.txt' });
  expect(await readFile(join(root, 'a', 'c copy.txt'), 'utf8')).toBe('c');
  expect(await call('POST /api/fs/copy', { root: 'r', from: 'a', to: 'a2' })).toMatchObject({ name: 'a2', kind: 'dir' });
  expect(await readFile(join(root, 'a2', 'c.txt'), 'utf8')).toBe('c');
  expect(await fail('POST /api/fs/copy', { root: 'r', from: 'a', to: 'a/x' })).toMatchObject({ code: 'moveIntoSelf' });
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

test('sqlite lists tables and pages rows, refusing a file that is no database', async () => {
  const { call, fail, root } = await setup();
  const { Database } = await import('bun:sqlite');
  const db = new Database(join(root, 'app.db'));
  db.run('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, photo BLOB)');
  db.run('CREATE TABLE "my table"(x)');
  for (let i = 0; i < 250; i++) db.run('INSERT INTO people (name, photo) VALUES (?, ?)', [`n${i}`, i === 0 ? new Uint8Array(3) : null]);
  db.close();
  const first = (await call('GET /api/fs/sqlite', 'root=r&path=app.db')) as { tables: { name: string }[]; table: string; columns: string[]; rows: unknown[][]; total: number };
  expect(first.tables.map((t) => t.name)).toEqual(['my table', 'people']);
  expect(first.table).toBe('my table');
  const people = (await call('GET /api/fs/sqlite', 'root=r&path=app.db&table=people&offset=200')) as typeof first;
  expect(people).toMatchObject({ table: 'people', columns: ['id', 'name', 'photo'], total: 250, offset: 200 });
  expect(people.rows).toHaveLength(50);
  const head = (await call('GET /api/fs/sqlite', 'root=r&path=app.db&table=people')) as typeof first;
  expect(head.rows[0]).toEqual([1, 'n0', '<blob 3 bytes>']);
  expect(await fail('GET /api/fs/sqlite', 'root=r&path=top.txt')).toMatchObject({ code: 'notSqlite' });
  expect(await fail('GET /api/fs/sqlite', 'root=r&path=../x')).toMatchObject({ code: 'badPath' });
});

test('raw with limit returns only the first bytes', async () => {
  const { call } = await setup();
  const res = (await call('GET /api/fs/raw', 'root=r&path=top.txt&limit=2')) as Response;
  expect(await res.text()).toBe('to');
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

const tailSetup = async (content: string | Buffer, saveAs?: (o: unknown) => Promise<string | null>) => {
  const t = await setup();
  const fs = rootedFs({ roots: async () => [{ id: 'r', path: t.root }], saveAs: saveAs as never });
  await writeFile(join(t.root, 'x.log'), content);
  const call = (key: string, input: string | Record<string, unknown>) =>
    fs.routes[key]!({
      req: new Request('http://x/'),
      query: new URLSearchParams(typeof input === 'string' ? input : ''),
      json: async () => input,
    } as unknown as RouteContext);
  return { ...t, call, fail: (key: string, input: string | Record<string, unknown>) => Promise.resolve(call(key, input)).catch((e: unknown) => e) };
};

test('tail reads whole lines and keeps the unterminated last line as partial', async () => {
  const { call } = await tailSetup('one\ntwo\nthr');
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=0')).toMatchObject({ from: 0, to: 8, size: 11, text: 'one\ntwo\n', partial: 'thr' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=4')).toMatchObject({ from: 4, to: 8, text: 'two\n', partial: 'thr' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=11')).toMatchObject({ from: 11, to: 11, text: '' });
});

test('tail without from drops the cut first line', async () => {
  const { call } = await tailSetup('aaaa\nbbbb\ncccc\n');
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&max=8')).toMatchObject({ from: 10, to: 15, text: 'cccc\n' });
});

test('tail reports reset when from is past the end', async () => {
  const { call } = await tailSetup('abc\n');
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=99')).toMatchObject({ reset: true, from: 4, to: 4, text: '' });
});

test('tail advances through one line longer than max', async () => {
  const { call } = await tailSetup('x'.repeat(3000));
  const chunk = (await call('GET /api/fs/tail', 'root=r&path=x.log&from=0&max=1000')) as { to: number; text: string; partial?: string };
  expect(chunk.to).toBe(1000);
  expect(chunk.text).toHaveLength(1000);
  expect(chunk.partial).toBeUndefined();
});

test('tail clamps max, refuses bad input, outside paths and binary files', async () => {
  const { call, fail, root } = await tailSetup('abc\n');
  await writeFile(join(root, 'b.bin'), Buffer.from([1, 0, 2]));
  expect(await fail('GET /api/fs/tail', 'root=r&path=x.log&from=1.5')).toMatchObject({ code: 'badRequest' });
  expect(await fail('GET /api/fs/tail', 'root=r&path=x.log&max=abc')).toMatchObject({ code: 'badRequest' });
  expect(await fail('GET /api/fs/tail', 'root=r&path=link/secret.txt')).toMatchObject({ code: 'outsideRoot' });
  expect(await fail('GET /api/fs/tail', 'root=r&path=b.bin')).toMatchObject({ code: 'notText' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&max=999999999')).toMatchObject({ text: 'abc\n' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&max=0')).toMatchObject({ size: 4 });
});

test('save-range writes the bytes after the bookmark to the dialog target', async () => {
  const seen: unknown[] = [];
  const t = await tailSetup('hello world\n', async (o) => {
    seen.push(o);
    return join(t.root, 'out.log');
  });
  expect(await t.call('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: 6 })).toEqual({ path: join(t.root, 'out.log'), bytes: 6 });
  expect(await readFile(join(t.root, 'out.log'), 'utf8')).toBe('world\n');
  expect(seen[0]).toMatchObject({ suggestedName: 'x-from-6.log' });
});

test('save-range writes nothing when cancelled and refuses stale or bad offsets', async () => {
  const t = await tailSetup('abc\n', async () => null);
  expect(await t.call('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: 0 })).toEqual({ path: null });
  expect(await t.fail('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: 99 })).toMatchObject({ code: 'rangeStale' });
  expect(await t.fail('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: -1 })).toMatchObject({ code: 'badRequest' });
});
