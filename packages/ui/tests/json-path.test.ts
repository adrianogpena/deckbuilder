import { describe, expect, test } from 'bun:test';
import { pathOf } from '../src/json-path.ts';

describe('pathOf', () => {
  test('root alone', () => {
    expect(pathOf([])).toBe('$');
  });

  test('dots identifiers, indexes numbers, quotes other keys', () => {
    expect(pathOf(['a', 2, 'b c'])).toBe('$.a[2]["b c"]');
    expect(pathOf(['_x', '$y', '1st', 'a-b', 'q"'])).toBe('$._x.$y["1st"]["a-b"]["q\\""]');
    expect(pathOf([''])).toBe('$[""]');
  });
});
