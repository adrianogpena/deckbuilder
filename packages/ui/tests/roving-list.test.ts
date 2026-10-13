import { describe, expect, test } from 'bun:test';
import { rovingIndex } from '../src/roving-list';

describe('rovingIndex', () => {
  test('arrows move by one and stop at the ends', () => {
    expect(rovingIndex('ArrowDown', 0, 3, 2)).toBe(1);
    expect(rovingIndex('ArrowDown', 2, 3, 2)).toBe(2);
    expect(rovingIndex('ArrowUp', 1, 3, 2)).toBe(0);
    expect(rovingIndex('ArrowUp', 0, 3, 2)).toBe(0);
  });

  test('Home and End jump to the ends', () => {
    expect(rovingIndex('Home', 2, 5, 2)).toBe(0);
    expect(rovingIndex('End', 0, 5, 2)).toBe(4);
  });

  test('page keys move by a page, at least one, clamped', () => {
    expect(rovingIndex('PageDown', 1, 10, 4)).toBe(5);
    expect(rovingIndex('PageDown', 8, 10, 4)).toBe(9);
    expect(rovingIndex('PageUp', 5, 10, 4)).toBe(1);
    expect(rovingIndex('PageUp', 2, 10, 4)).toBe(0);
    expect(rovingIndex('PageDown', 0, 10, 0)).toBe(1);
  });

  test('other keys and empty lists give null', () => {
    expect(rovingIndex('Enter', 0, 3, 1)).toBeNull();
    expect(rovingIndex('ArrowDown', 0, 0, 1)).toBeNull();
  });
});
