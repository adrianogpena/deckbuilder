import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountPrefsStore, validateAccountPrefs } from './account-prefs.ts';

test('accepts known keys and drops empty entries', () => {
  expect(validateAccountPrefs({ '.claude-work': { usage: { show: true, position: 'top' }, icons: { idle: 'pause' } }, '.claude': { usage: {}, icons: {} } })).toEqual({
    '.claude-work': { usage: { show: true, position: 'top' }, icons: { idle: 'pause' } },
  });
});

test('rejects unknown keys, bad values, foreign icons and unknown accounts', () => {
  expect(validateAccountPrefs([])).toBeUndefined();
  expect(validateAccountPrefs({ a: { other: 1 } })).toBeUndefined();
  expect(validateAccountPrefs({ a: { usage: { nope: true } } })).toBeUndefined();
  expect(validateAccountPrefs({ a: { usage: { show: 'yes' } } })).toBeUndefined();
  expect(validateAccountPrefs({ a: { usage: { position: 'left' } } })).toBeUndefined();
  expect(validateAccountPrefs({ a: { icons: { idle: 'ring-x' } } })).toBeUndefined();
  expect(validateAccountPrefs({ a: { icons: { running: 'ring' } } })).toBeUndefined();
  expect(validateAccountPrefs({ a: { icons: { done: 'dot' } } })).toBeUndefined();
  expect(validateAccountPrefs({ a: { icons: { idle: 'pause' } } }, ['b'])).toBeUndefined();
});

test('store persists, ignores invalid sets and removes an account', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'agents-prefs-')), 'agents', 'account-prefs.json');
  const s = createAccountPrefsStore(file);
  expect(s.get()).toEqual({});
  expect(s.set({ a: { icons: { stopped: 'check' } } })).toBe(true);
  expect(s.set({ a: { icons: { stopped: 'nope' } } })).toBe(false);
  expect(createAccountPrefsStore(file).get()).toEqual({ a: { icons: { stopped: 'check' } } });
  expect(s.remove('a')).toBe(true);
  expect(s.remove('a')).toBe(false);
  expect(createAccountPrefsStore(file).get()).toEqual({});
});
