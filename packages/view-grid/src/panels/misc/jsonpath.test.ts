import { describe, expect, test } from 'bun:test';
import { asNumber, lookupPath } from './jsonpath';

const data = { data: { items: [{ count: 7 }, { count: 9 }], name: 'x' } };

describe('lookupPath', () => {
  test('walks objects and array indexes', () => {
    expect(lookupPath(data, 'data.items.0.count')).toBe(7);
    expect(lookupPath(data, 'data.items.1.count')).toBe(9);
    expect(lookupPath(data, 'data.name')).toBe('x');
  });

  test('empty path returns the root', () => {
    expect(lookupPath(data, '')).toBe(data);
  });

  test('missing steps and prototype keys are undefined', () => {
    expect(lookupPath(data, 'data.nope.x')).toBeUndefined();
    expect(lookupPath(data, 'data.items.2.count')).toBeUndefined();
    expect(lookupPath(data, 'data.items.length')).toBeUndefined();
    expect(lookupPath(data, 'constructor')).toBeUndefined();
    expect(lookupPath(null, 'a')).toBeUndefined();
  });
});

describe('asNumber', () => {
  test('accepts numbers and numeric strings only', () => {
    expect(asNumber(3)).toBe(3);
    expect(asNumber('4.5')).toBe(4.5);
    expect(asNumber('')).toBeUndefined();
    expect(asNumber('abc')).toBeUndefined();
    expect(asNumber(NaN)).toBeUndefined();
    expect(asNumber({})).toBeUndefined();
  });
});
