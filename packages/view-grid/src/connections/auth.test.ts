import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authHeader, ghHostname, ghToken, resolveConnection, testConnection, type Spawn } from './auth';
import { createConnectionStore } from './store';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
const fresh = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auth-'));
  dirs.push(dir);
  return createConnectionStore(dir);
};

describe('authHeader', () => {
  test('jira with a user is basic, without is bearer, github is bearer', () => {
    expect(authHeader({ user: 'a@b.c', token: 't' }, 'jira')).toBe(`Basic ${btoa('a@b.c:t')}`);
    expect(authHeader({ token: 'pat' }, 'jira')).toBe('Bearer pat');
    expect(authHeader({ token: 'g' }, 'github')).toBe('Bearer g');
  });
});

describe('gh fallback', () => {
  test('hostname only for Enterprise', () => {
    expect(ghHostname('https://api.github.com')).toBeUndefined();
    expect(ghHostname('https://ghe.corp.com/api/v3')).toBe('ghe.corp.com');
  });

  test('passes --hostname and trims the token', async () => {
    let seen: string[] = [];
    const spawn: Spawn = async (cmd) => {
      seen = cmd;
      return { code: 0, stdout: 'gho_x\n' };
    };
    expect(await ghToken('https://ghe.corp.com/api/v3', spawn)).toBe('gho_x');
    expect(seen).toEqual(['gh', 'auth', 'token', '--hostname', 'ghe.corp.com']);
  });

  test('missing gh or failure is not-configured', async () => {
    const missing: Spawn = async () => {
      throw new Error('ENOENT');
    };
    await expect(ghToken('https://api.github.com', missing)).rejects.toMatchObject({ code: 'source-not-configured' });
    const failed: Spawn = async () => ({ code: 1, stdout: '' });
    await expect(ghToken('https://api.github.com', failed)).rejects.toMatchObject({ code: 'source-not-configured' });
  });
});

describe('resolveConnection', () => {
  test('unknown id is not-configured; empty github token uses gh', async () => {
    const store = await fresh();
    await expect(resolveConnection(store, 'nope', 'github')).rejects.toMatchObject({ code: 'source-not-configured' });
    const c = await store.save({ type: 'github', name: 'GH', baseUrl: '' });
    const r = await resolveConnection(store, c.id, 'github', async () => ({ code: 0, stdout: 'tok' }));
    expect(r).toEqual({ baseUrl: 'https://api.github.com', token: 'tok' });
    await expect(resolveConnection(store, c.id, 'jira')).rejects.toMatchObject({ code: 'source-not-configured' });
  });

  test('jira without a token is not-configured', async () => {
    const store = await fresh();
    const c = await store.save({ type: 'jira', name: 'J', baseUrl: 'https://j.io' });
    await expect(resolveConnection(store, c.id, 'jira')).rejects.toMatchObject({ code: 'source-not-configured' });
  });
});

describe('testConnection', () => {
  test('returns the user', async () => {
    const store = await fresh();
    const c = await store.save({ type: 'jira', name: 'J', baseUrl: 'https://j.io', user: 'a@b.c', token: 't' });
    let url = '';
    globalThis.fetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ displayName: 'Ada' }));
    }) as unknown as typeof fetch;
    expect(await testConnection(store, c.id)).toEqual({ ok: true, user: 'Ada' });
    expect(url).toBe('https://j.io/rest/api/2/myself');
  });

  test('a rejected token is an auth error result', async () => {
    const store = await fresh();
    const c = await store.save({ type: 'jira', name: 'J', baseUrl: 'https://j.io', token: 'bad' });
    globalThis.fetch = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    expect(await testConnection(store, c.id)).toMatchObject({ ok: false, error: { code: 'source-auth' } });
  });
});
