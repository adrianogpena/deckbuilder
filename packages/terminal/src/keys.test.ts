import { expect, test } from 'bun:test';
import type { KeyLike } from '@kedalion/ui/keybindings';
import { terminalKeyAction } from './keys.ts';

const key = (letter: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: letter.toLowerCase(),
  code: `Key${letter}`,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});
const app = new Set(['Ctrl+K', 'Ctrl+Shift+P']);

test('app chords go to the app', () => {
  expect(terminalKeyAction(key('K', { ctrlKey: true }), false, app)).toBe('app');
  expect(terminalKeyAction(key('P', { ctrlKey: true, shiftKey: true }), false, app)).toBe('app');
});

test('other chords go to the program', () => {
  expect(terminalKeyAction(key('B', { ctrlKey: true }), false, app)).toBe('terminal');
  expect(terminalKeyAction(key('T', { ctrlKey: true }), false, app)).toBe('terminal');
  expect(terminalKeyAction(key('A'), false, app)).toBe('terminal');
});

test('Ctrl+C copies only with a selection', () => {
  expect(terminalKeyAction(key('C', { ctrlKey: true }), true, app)).toBe('copy');
  expect(terminalKeyAction(key('C', { ctrlKey: true }), false, app)).toBe('terminal');
  expect(terminalKeyAction(key('C', { ctrlKey: true, shiftKey: true }), true, app)).toBe('copy');
});

test('Ctrl+V and Ctrl+Shift+V paste', () => {
  expect(terminalKeyAction(key('V', { ctrlKey: true }), false, app)).toBe('paste');
  expect(terminalKeyAction(key('V', { ctrlKey: true, shiftKey: true }), false, app)).toBe('paste');
});
