import { describe, expect, test } from 'bun:test';
import { actionRoute, checkSources, defineSource, sourceRoute, sourceRoutes, streamRoute } from './server.ts';

const source = defineSource<{ repo: string }>({
  id: 'echo',
  fields: [{ key: 'repo', kind: 'string', label: 'l', default: 'none' }],
  fetch: (config) => ({ repo: config.repo }),
});

const run = (route: unknown, body: unknown) =>
  (route as (rc: unknown) => Promise<unknown>)({ req: new Request('http://x', { method: 'POST' }), json: async () => body });

describe('sourceRoutes', () => {
  test('a source route cleans the config before fetch', async () => {
    const routes = sourceRoutes([source]);
    expect(await run(routes[sourceRoute('echo')], { config: { repo: 'a/b', extra: 1 } })).toEqual({ repo: 'a/b' });
    expect(await run(routes[sourceRoute('echo')], {})).toEqual({ repo: 'none' });
  });

  test('rejects a duplicate source id', () => {
    expect(() => checkSources([source, source], 'test')).toThrow();
  });

  test('action and stream routes', async () => {
    const withExtras = defineSource<{ repo: string }>({
      id: 'extras',
      fields: [{ key: 'repo', kind: 'string', label: 'l', default: 'none' }],
      fetch: () => null,
      actions: { 'add-one': (payload, config) => ({ payload, repo: config.repo }) },
      streams: { logs: (query) => new Response(query.get('q') ?? '') },
    });
    const routes = sourceRoutes([withExtras]);
    expect(await run(routes[actionRoute('extras', 'add-one')], { config: { repo: 'a', x: 1 }, payload: 5 })).toEqual({ payload: 5, repo: 'a' });
    const res = (await (routes[streamRoute('extras', 'logs')] as (rc: unknown) => unknown)({ req: new Request('http://x'), query: new URLSearchParams('q=hi') })) as Response;
    expect(await res.text()).toBe('hi');
  });

  test('rejects a bad action name', () => {
    const bad = defineSource({ id: 'bad', fields: [], fetch: () => null, actions: { 'Bad Name': () => null } });
    expect(() => checkSources([bad], 'test')).toThrow();
  });
});
