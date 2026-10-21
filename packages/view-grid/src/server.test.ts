import { describe, expect, test } from 'bun:test';
import { CLOCK_SPEC, defineSource, gridServerView, sourceRoute } from './server.ts';

const source = defineSource<{ repo: string }>({
  id: 'echo',
  fields: [{ key: 'repo', kind: 'string', label: 'l', default: 'none' }],
  fetch: (config) => ({ repo: config.repo }),
});

const run = (route: unknown, body: unknown) =>
  (route as (rc: unknown) => Promise<unknown>)({ req: new Request('http://x', { method: 'POST' }), json: async () => body });

describe('gridServerView', () => {
  const view = gridServerView({ panels: [CLOCK_SPEC, { kind: 'list', allowMultiple: false }], sources: [source] });
  const validate = view.settings!.validate.gridLayout!;
  const box = { x: 0, y: 0, w: 6, h: 8 };

  test('validates gridLayout against the registered kinds', () => {
    expect(validate([{ id: 'clock', ...box }])).toEqual([{ id: 'clock', kind: 'clock', config: { timeZone: '', hour12: false, showSeconds: true, showDate: true, layout: 'digital' }, ...box }]);
    expect(validate([{ id: 'zzz', ...box }])).toBeNull();
  });

  test('a source route cleans the config before fetch', async () => {
    const routes = view.routes({ dataDir: '', settings: { load: async () => ({}) }, stores: {} });
    expect(await run(routes[sourceRoute('echo')], { config: { repo: 'a/b', extra: 1 } })).toEqual({ repo: 'a/b' });
    expect(await run(routes[sourceRoute('echo')], {})).toEqual({ repo: 'none' });
  });

  test('rejects a duplicate source id', () => {
    expect(() => gridServerView({ panels: [], sources: [source, source] })).toThrow();
  });
});
