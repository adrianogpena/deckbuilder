import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RouteContext } from '@deckbuilder/server-core';
import type { HttpRequestDraft, RestHistoryEntry } from '@deckbuilder/server-core/protocol';
import { httpExecutor, httpRoutes } from './http.ts';
import { restHistory } from './rest-history.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rest-history-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const draft = (url: string): HttpRequestDraft => ({
  method: 'GET',
  url,
  headers: [
    { name: 'Authorization', value: 'Bearer secret', enabled: true },
    { name: 'Accept', value: '*/*', enabled: true },
  ],
  body: '',
  bodyLang: 'text',
});
const entry = (url: string) => ({ at: Date.now(), method: 'GET' as const, url, status: 200, ms: 1, draft: draft(url) });

describe('restHistory', () => {
  test('appends newest first, persists and drops Authorization', async () => {
    const h = restHistory({ dir, max: 10 });
    await h.append(entry('{{base}}/a'));
    await h.append(entry('{{base}}/b'));
    const again = restHistory({ dir, max: 10 });
    const list = await again.list();
    expect(list.map((e) => e.url)).toEqual(['{{base}}/b', '{{base}}/a']);
    expect(list[0]!.draft.headers.map((h) => h.name)).toEqual(['Accept']);
    expect(await readdir(dir)).toEqual(['rest-history.json']);
  });

  test('caps at max, searches, clears and turns off at 0', async () => {
    const h = restHistory({ dir, max: 2 });
    for (const p of ['users', 'orders', 'items']) await h.append(entry(`http://x/${p}`));
    expect((await h.list()).map((e) => e.url)).toEqual(['http://x/items', 'http://x/orders']);
    expect((await h.list({ q: 'ORD' })).map((e) => e.url)).toEqual(['http://x/orders']);
    await h.clear();
    expect(await h.list()).toEqual([]);
    h.setMax(0);
    expect(await h.append(entry('http://x/z'))).toBeNull();
    expect(await h.list()).toEqual([]);
  });
});

describe('httpRoutes onSend', () => {
  const routesWith = (sent: Array<Omit<RestHistoryEntry, 'id'>>) =>
    httpRoutes(httpExecutor({ fetchImpl: (async () => new Response('ok', { status: 201 })) as unknown as typeof fetch }), {
      environmentVars: async () => ({ base: 'http://example.test' }),
      onSend: (e) => sent.push(e),
    });
  const send = (routes: ReturnType<typeof httpRoutes>, body: Record<string, unknown>) =>
    Promise.resolve(routes['POST /api/http/send']!({ req: new Request('http://x/'), json: async () => ({ environment: 'e', ...body }) } as unknown as RouteContext));

  test('records the unresolved request without Authorization', async () => {
    const sent: Array<Omit<RestHistoryEntry, 'id'>> = [];
    const routes = routesWith(sent);
    await send(routes, {
      request: { method: 'POST', url: '{{base}}/a', headers: [['Authorization', 'Basic eA=='], ['Content-Type', 'application/json']], body: '{}' },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'POST', url: '{{base}}/a', status: 201 });
    expect(sent[0]!.draft).toMatchObject({ bodyLang: 'json', authKind: 'basic', body: '{}' });
    expect(sent[0]!.draft.headers.map((h) => h.name)).toEqual(['Content-Type']);
  });

  test('prefers the given draft and records failures with status 0', async () => {
    const sent: Array<Omit<RestHistoryEntry, 'id'>> = [];
    const routes = routesWith(sent);
    await send(routes, { request: { method: 'GET', url: '{{base}}/a' }, draft: draft('{{base}}/a') });
    expect(sent[0]!.draft.headers.map((h) => h.name)).toEqual(['Accept']);
    await expect(send(routes, { request: { method: 'GET', url: '{{nope}}/a' } })).rejects.toThrow();
    expect(sent[1]).toMatchObject({ url: '{{nope}}/a', status: 0, error: 'unknownVariable' });
  });
});
