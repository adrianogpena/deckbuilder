import { describe, expect, test } from 'bun:test';
import '../../server';
import { groupEntries, pick, readContexts } from './server';

describe('groupEntries', () => {
  test('one cluster per context and namespace', () => {
    const g = groupEntries([
      { context: 'a', namespace: 'x', pod: 'web' },
      { context: 'a', namespace: 'y', pod: 'db' },
      { context: 'a', namespace: 'x', pod: 'api' },
      { context: 'a', namespace: 'x', pod: 'web' },
    ]);
    expect(g).toEqual([
      { context: 'a', namespace: 'x', patterns: ['web', 'api'] },
      { context: 'a', namespace: 'y', patterns: ['db'] },
    ]);
  });
});

describe('pick', () => {
  const config = { clusters: 'ctx1 ns1 web\nctx2 ns2 db' };
  test('accepts an entry cluster and a valid pod', () => {
    expect(pick(config, { context: 'ctx2', namespace: 'ns2', pod: 'db-1' }).pod).toBe('db-1');
  });
  test('rejects an unknown cluster', () => {
    expect(() => pick(config, { context: 'ctx1', namespace: 'ns2', pod: 'web-1' })).toThrow();
  });
  test('rejects an invalid pod name', () => {
    expect(() => pick(config, { context: 'ctx1', namespace: 'ns1', pod: '../x' })).toThrow();
  });
});

describe('readContexts', () => {
  test('reads names, namespaces and current', () => {
    const out = readContexts(JSON.stringify({ contexts: [{ name: 'a', context: { namespace: 'n' } }, { name: 'b' }, {}], 'current-context': 'b' }));
    expect(out).toEqual({ contexts: [{ name: 'a', namespace: 'n' }, { name: 'b' }], current: 'b' });
  });
  test('bad json gives none', () => {
    expect(readContexts('x')).toEqual({ contexts: [] });
  });
});
