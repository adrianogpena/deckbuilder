import { describe, expect, test } from 'bun:test';
import { backoffMs, nextUnchanged } from './refresh';

describe('backoffMs', () => {
  test('grows by 1.5 and stops at 4x', () => {
    expect(backoffMs(30_000, 0)).toBe(30_000);
    expect(backoffMs(30_000, 1)).toBe(45_000);
    expect(backoffMs(30_000, 2)).toBe(67_500);
    expect(backoffMs(30_000, 9)).toBe(120_000);
  });
});

describe('nextUnchanged', () => {
  test('counts automatic refreshes with the same data, resets on change or manual refresh', () => {
    expect(nextUnchanged(2, true, true)).toBe(3);
    expect(nextUnchanged(2, false, true)).toBe(0);
    expect(nextUnchanged(2, true, false)).toBe(0);
  });
});
