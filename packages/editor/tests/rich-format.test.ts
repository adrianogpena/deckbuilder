import { describe, expect, test } from 'bun:test';
import { isCheckboxHit, nextChecked, normalizeHref, splitItemAttrs, splitOverflow } from '../src/rich/format.ts';

describe('splitOverflow', () => {
  test('all fit without the More button', () => {
    expect(splitOverflow([28, 28, 28], 88, 28, 2)).toBe(3);
  });
  test('keeps room for More when some do not fit', () => {
    expect(splitOverflow([28, 28, 28, 28], 100, 28, 2)).toBe(2);
  });
  test('nothing fits', () => {
    expect(splitOverflow([28, 28], 30, 28, 2)).toBe(0);
  });
});

describe('tasks', () => {
  test('nextChecked', () => {
    expect(nextChecked(null)).toBe(false);
    expect(nextChecked(false)).toBe(true);
    expect(nextChecked(true)).toBe(false);
  });
  test('splitItemAttrs continues a task unchecked and leaves plain items plain', () => {
    expect(splitItemAttrs({ label: '9.', checked: true })).toEqual({ label: '9.', checked: false });
    expect(splitItemAttrs({ label: '•', checked: null })).toEqual({ label: '•', checked: null });
  });
  test('isCheckboxHit', () => {
    expect(isCheckboxHit(10, 22)).toBe(true);
    expect(isCheckboxHit(22, 22)).toBe(false);
    expect(isCheckboxHit(-1, 22)).toBe(false);
  });
});

test('normalizeHref', () => {
  expect(normalizeHref('  https://x.dev ')).toBe('https://x.dev');
  expect(normalizeHref('   ')).toBeNull();
});
