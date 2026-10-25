import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secretStore } from './secrets.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'kedalion-secrets-'));
  dirs.push(dir);
  return { dir, store: secretStore('kedalion-test', dir) };
}

test.skipIf(process.platform !== 'win32')('set, get and remove roundtrip without storing the plain value', async () => {
  const { dir, store } = await setup();
  expect(store.available()).toBe(true);
  expect(await store.get('db:1:password')).toBeNull();

  await store.set('db:1:password', 'hunter2-plain');
  expect(await store.get('db:1:password')).toBe('hunter2-plain');
  const saved = await readFile(join(dir, 'secrets.json'), 'utf8');
  expect(saved).not.toContain('hunter2-plain');
  expect(JSON.parse(saved).items['db:1:password']).toBeString();

  expect(await secretStore('kedalion-test', dir).get('db:1:password')).toBe('hunter2-plain');

  await store.remove('db:1:password');
  expect(await store.get('db:1:password')).toBeNull();
});

test.skipIf(process.platform !== 'win32')('unicode and empty values survive', async () => {
  const { store } = await setup();
  await store.set('u', 'senha ção 🔑 中文');
  await store.set('e', '');
  expect(await store.get('u')).toBe('senha ção 🔑 中文');
  expect(await store.get('e')).toBe('');
});

test.skipIf(process.platform !== 'win32')('a blob sealed for another app id is unreadable', async () => {
  const { dir, store } = await setup();
  await store.set('x', 'v');
  expect(await secretStore('other-app', dir).get('x').catch((e) => e)).toMatchObject({ code: 'secretUnreadable' });
});

test('refs are validated', async () => {
  const { store } = await setup();
  await expect(store.get('a b')).rejects.toThrow('invalid ref');
});
