import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '@deckbuilder/server-core';
import { acquireLock, createInstance, handOff, type OpenMode } from './instance.ts';

const dirs: string[] = [];
const servers: Array<ReturnType<typeof startServer>> = [];
afterEach(() => {
  for (const s of servers.splice(0)) void s.stop(true);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function running() {
  const dir = mkdtempSync(join(tmpdir(), 'deckbuilder-instance-'));
  dirs.push(dir);
  const file = join(dir, 'instance.json');
  const opened: OpenMode[] = [];
  const paths: Array<string | undefined> = [];
  const instance = createInstance(file, (mode, path) => {
    opened.push(mode);
    paths.push(path);
    return 'http://127.0.0.1/ui';
  });
  const server = startServer({ routes: {}, unauthenticated: instance.routes, token: 'session', web: { files: {} } });
  servers.push(server);
  instance.publish(server.port!);
  return { file, opened, paths, server };
}

test('a second launch hands its mode to the running instance', async () => {
  const { file, opened } = running();
  expect(await handOff(file, 'window')).toBe('http://127.0.0.1/ui');
  expect(await handOff(file, 'none')).toBe('http://127.0.0.1/ui');
  expect(opened).toEqual(['window', 'none']);
});

test('the handoff carries the path and the route drops an unsafe one', async () => {
  const { file, paths, server } = running();
  await handOff(file, 'window', 'settings');
  await handOff(file, 'window');
  const info = JSON.parse(readFileSync(file, 'utf8')) as { secret: string };
  await fetch(`http://127.0.0.1:${server.port}/api/instance/open`, {
    method: 'POST',
    headers: { 'x-deckbuilder-instance': info.secret },
    body: JSON.stringify({ mode: 'window', path: '../x<script>' }),
  });
  expect(paths).toEqual(['settings', undefined, undefined]);
});

test('no file or a stale one means no running instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deckbuilder-instance-'));
  dirs.push(dir);
  const file = join(dir, 'instance.json');
  expect(await handOff(file, 'window')).toBeNull();
  writeFileSync(file, JSON.stringify({ pid: 1, port: 1, secret: 'x' }));
  expect(await handOff(file, 'window')).toBeNull();
});

test('the route wants the instance secret, and the API still wants the session token', async () => {
  const { opened, server } = running();
  const base = `http://127.0.0.1:${server.port}`;
  const open = await fetch(`${base}/api/instance/open`, { method: 'POST', headers: { 'x-deckbuilder-instance': 'wrong' }, body: '{}' });
  expect(open.status).toBe(403);
  expect(opened).toEqual([]);
  expect((await fetch(`${base}/api/other`, { headers: { 'x-deckbuilder-instance': 'wrong' } })).status).toBe(401);
});

function lockFile() {
  const dir = mkdtempSync(join(tmpdir(), 'deckbuilder-lock-'));
  dirs.push(dir);
  return join(dir, 'instance.lock');
}

test('the lock is acquired in an empty folder', () => {
  const file = lockFile();
  expect(acquireLock(file)).toBe('acquired');
  expect(readFileSync(file, 'utf8')).toBe(String(process.pid));
});

test('a lock of another live process is held', () => {
  const file = lockFile();
  writeFileSync(file, String(process.ppid));
  expect(acquireLock(file)).toBe('held');
});

test('a lock of an exited process is taken over', async () => {
  const file = lockFile();
  const child = Bun.spawn([process.execPath, '-e', '0']);
  await child.exited;
  writeFileSync(file, String(child.pid));
  expect(acquireLock(file)).toBe('acquired');
  expect(readFileSync(file, 'utf8')).toBe(String(process.pid));
});

test('a lock with garbage content is taken over', () => {
  const file = lockFile();
  writeFileSync(file, 'not a pid');
  expect(acquireLock(file)).toBe('acquired');
});
