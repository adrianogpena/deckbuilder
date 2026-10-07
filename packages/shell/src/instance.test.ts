import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '@deckbase/server-core';
import { createInstance, handOff, type OpenMode } from './instance.ts';

const dirs: string[] = [];
const servers: Array<ReturnType<typeof startServer>> = [];
afterEach(() => {
  for (const s of servers.splice(0)) void s.stop(true);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function running() {
  const dir = mkdtempSync(join(tmpdir(), 'deckbase-instance-'));
  dirs.push(dir);
  const file = join(dir, 'instance.json');
  const opened: OpenMode[] = [];
  const instance = createInstance(file, (mode) => {
    opened.push(mode);
    return 'http://127.0.0.1/ui';
  });
  const server = startServer({ routes: {}, unauthenticated: instance.routes, token: 'session', web: { files: {} } });
  servers.push(server);
  instance.publish(server.port!);
  return { file, opened, server };
}

test('a second launch hands its mode to the running instance', async () => {
  const { file, opened } = running();
  expect(await handOff(file, 'window')).toBe('http://127.0.0.1/ui');
  expect(await handOff(file, 'none')).toBe('http://127.0.0.1/ui');
  expect(opened).toEqual(['window', 'none']);
});

test('no file or a stale one means no running instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deckbase-instance-'));
  dirs.push(dir);
  const file = join(dir, 'instance.json');
  expect(await handOff(file, 'window')).toBeNull();
  writeFileSync(file, JSON.stringify({ pid: 1, port: 1, secret: 'x' }));
  expect(await handOff(file, 'window')).toBeNull();
});

test('the route wants the instance secret, and the API still wants the session token', async () => {
  const { opened, server } = running();
  const base = `http://127.0.0.1:${server.port}`;
  const open = await fetch(`${base}/api/instance/open`, { method: 'POST', headers: { 'x-deckbase-instance': 'wrong' }, body: '{}' });
  expect(open.status).toBe(403);
  expect(opened).toEqual([]);
  expect((await fetch(`${base}/api/other`, { headers: { 'x-deckbase-instance': 'wrong' } })).status).toBe(401);
});
