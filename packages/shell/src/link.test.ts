import { expect, test } from 'bun:test';
import { isSafePath, parseAppLink } from './link.ts';

test('parseAppLink returns the path of an open link', () => {
  expect(parseAppLink('deckbuilder://open/settings', 'deckbuilder')).toBe('settings');
  expect(parseAppLink('deckbuilder://open/settings/', 'deckbuilder')).toBe('settings');
  expect(parseAppLink('deckbuilder://open/a/b-c_d.e', 'deckbuilder')).toBe('a/b-c_d.e');
  expect(parseAppLink('deckbuilder://open', 'deckbuilder')).toBe('');
});

test('parseAppLink rejects other schemes, other actions and unsafe paths', () => {
  expect(parseAppLink('other://open/settings', 'deckbuilder')).toBeNull();
  expect(parseAppLink('deckbuilder://openx/settings', 'deckbuilder')).toBeNull();
  expect(parseAppLink('deckbuilder://close/settings', 'deckbuilder')).toBeNull();
  expect(parseAppLink('deckbuilder://open/../secret', 'deckbuilder')).toBeNull();
  expect(parseAppLink('deckbuilder://open/<script>', 'deckbuilder')).toBeNull();
  expect(parseAppLink('deckbuilder://open/a?x=1', 'deckbuilder')).toBeNull();
});

test('isSafePath', () => {
  expect(isSafePath('settings')).toBe(true);
  expect(isSafePath('')).toBe(true);
  expect(isSafePath('a/../b')).toBe(false);
  expect(isSafePath('a b')).toBe(false);
});
