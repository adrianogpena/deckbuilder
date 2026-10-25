import { expect, test } from 'bun:test';
import { isSafePath, parseAppLink } from './link.ts';

test('parseAppLink returns the path of an open link', () => {
  expect(parseAppLink('kedalion://open/settings', 'kedalion')).toBe('settings');
  expect(parseAppLink('kedalion://open/settings/', 'kedalion')).toBe('settings');
  expect(parseAppLink('kedalion://open/a/b-c_d.e', 'kedalion')).toBe('a/b-c_d.e');
  expect(parseAppLink('kedalion://open', 'kedalion')).toBe('');
});

test('parseAppLink rejects other schemes, other actions and unsafe paths', () => {
  expect(parseAppLink('other://open/settings', 'kedalion')).toBeNull();
  expect(parseAppLink('kedalion://openx/settings', 'kedalion')).toBeNull();
  expect(parseAppLink('kedalion://close/settings', 'kedalion')).toBeNull();
  expect(parseAppLink('kedalion://open/../secret', 'kedalion')).toBeNull();
  expect(parseAppLink('kedalion://open/<script>', 'kedalion')).toBeNull();
  expect(parseAppLink('kedalion://open/a?x=1', 'kedalion')).toBeNull();
});

test('isSafePath', () => {
  expect(isSafePath('settings')).toBe(true);
  expect(isSafePath('')).toBe(true);
  expect(isSafePath('a/../b')).toBe(false);
  expect(isSafePath('a b')).toBe(false);
});
