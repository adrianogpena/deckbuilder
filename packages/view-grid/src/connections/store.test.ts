import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectionStore } from './store';

const dirs: string[] = [];
const fresh = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conn-'));
  dirs.push(dir);
  return { dir, store: createConnectionStore(dir) };
};
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('connection store', () => {
  test('lists hasToken instead of the token', async () => {
    const { store, dir } = await fresh();
    const saved = await store.save({ type: 'jira', name: 'Work', baseUrl: 'https://x.atlassian.net/', user: 'a@b.c', token: 'secret' });
    expect(saved).toMatchObject({ type: 'jira', baseUrl: 'https://x.atlassian.net', hasToken: true });
    expect(JSON.stringify(await store.list())).not.toContain('secret');
    expect(await readFile(join(dir, 'grid', 'connections.json'), 'utf8')).toContain('secret');
    expect((await store.get(saved.id))?.token).toBe('secret');
  });

  test('an empty token keeps the old one', async () => {
    const { store } = await fresh();
    const saved = await store.save({ type: 'github', name: 'GH', baseUrl: '', token: 'tok' });
    expect(saved.baseUrl).toBe('https://api.github.com');
    await store.save({ id: saved.id, name: 'Renamed', baseUrl: '', token: '' });
    const got = await store.get(saved.id);
    expect(got).toMatchObject({ name: 'Renamed', token: 'tok', type: 'github' });
  });

  test('a new token replaces the old one, delete removes', async () => {
    const { store } = await fresh();
    const saved = await store.save({ type: 'github', name: 'GH', baseUrl: '', token: 'one' });
    await store.save({ id: saved.id, name: 'GH', baseUrl: '', token: 'two' });
    expect((await store.get(saved.id))?.token).toBe('two');
    await store.remove(saved.id);
    expect(await store.list()).toEqual([]);
  });

  test('rejects bad input and unknown ids', async () => {
    const { store } = await fresh();
    await expect(store.save({ type: 'jira', name: 'x', baseUrl: '' })).rejects.toMatchObject({ code: 'connection-url' });
    await expect(store.save({ type: 'jira', name: '', baseUrl: 'https://x.io' })).rejects.toMatchObject({ code: 'connection-name' });
    await expect(store.save({ type: 'nope', name: 'x', baseUrl: 'https://x.io' })).rejects.toMatchObject({ code: 'connection-type' });
    await expect(store.save({ id: 'missing', name: 'x', baseUrl: 'https://x.io' })).rejects.toMatchObject({ code: 'connection-missing' });
  });

  test('concurrent saves are all kept', async () => {
    const { store } = await fresh();
    await Promise.all([1, 2, 3, 4].map((n) => store.save({ type: 'github', name: `n${n}`, baseUrl: '' })));
    expect((await store.list()).length).toBe(4);
  });
});
