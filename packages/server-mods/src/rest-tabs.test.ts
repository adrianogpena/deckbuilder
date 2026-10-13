import { expect, test } from 'bun:test';
import { REST_TABS_MAX, validateRestTabs } from './rest-tabs.ts';

const draft = {
  method: 'GET',
  url: 'https://example.com',
  headers: [
    { name: 'Accept', value: 'application/json', enabled: true },
    { name: ' authorization', value: 'Bearer x', enabled: true },
  ],
  body: '',
  bodyLang: 'json',
  auth: 'Bearer y',
};

test('validateRestTabs drops Authorization and unknown fields', () => {
  const out = validateRestTabs({ version: 1, tabs: [{ id: 'a', draft, savedId: 'r1', title: 'T', auth: 'z' }], active: 'a' });
  expect(out).toEqual({
    version: 1,
    tabs: [{ id: 'a', draft: { method: 'GET', url: 'https://example.com', headers: [{ name: 'Accept', value: 'application/json', enabled: true }], body: '', bodyLang: 'json' }, savedId: 'r1', title: 'T' }],
    active: 'a',
  });
});

test('validateRestTabs refuses bad shapes', () => {
  const bad = [
    null,
    { version: 2, tabs: [] },
    { version: 1, tabs: {} },
    { version: 1, tabs: [{ id: 'a b', draft }] },
    { version: 1, tabs: [{ id: 'a', draft }, { id: 'a', draft }] },
    { version: 1, tabs: [{ id: 'a', draft: { ...draft, method: 'NOPE' } }] },
    { version: 1, tabs: [{ id: 'a', draft, savedId: 3 }] },
    { version: 1, tabs: [{ id: 'a', draft }], active: 'b' },
    { version: 1, tabs: Array.from({ length: REST_TABS_MAX + 1 }, (_, n) => ({ id: `t${n}`, draft })) },
  ];
  for (const input of bad) expect(() => validateRestTabs(input)).toThrow();
});
