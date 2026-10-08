import { describe, expect, test } from 'bun:test';
import { pickedPaths } from './dialogs.ts';

describe('pickedPaths', () => {
  test('take returns true once', () => {
    const picked = pickedPaths();
    picked.add('C:\p');
    expect(picked.take('C:\p')).toBe(true);
    expect(picked.take('C:\p')).toBe(false);
  });

  test('take of a path never added is false', () => {
    const picked = pickedPaths();
    picked.add('C:\p');
    expect(picked.take('C:\P')).toBe(false);
    expect(picked.take('C:\q')).toBe(false);
  });

  test('entries expire after ttlMs', () => {
    let now = 1_000;
    const picked = pickedPaths({ ttlMs: 100, now: () => now });
    picked.add('a');
    picked.add('b');
    now += 99;
    expect(picked.take('a')).toBe(true);
    now += 1;
    expect(picked.take('b')).toBe(false);
  });

  test('adding beyond max drops the oldest entry', () => {
    const picked = pickedPaths({ max: 2 });
    picked.add('a');
    picked.add('b');
    picked.add('c');
    expect(picked.take('a')).toBe(false);
    expect(picked.take('b')).toBe(true);
    expect(picked.take('c')).toBe(true);
  });
});
