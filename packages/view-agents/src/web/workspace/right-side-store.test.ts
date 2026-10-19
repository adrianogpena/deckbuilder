import { describe, expect, test } from 'bun:test';
import { parseRightSide } from './right-side-store';

const known = (k: string) => k === 'files' || k === 'diff';

describe('right side store', () => {
  test('drops unknown kinds, duplicates and bad shapes', () => {
    const raw = { '': { list: ['files', 'nope', 'files', 3, 'diff'], open: true }, p: 'x' };
    expect(parseRightSide(raw, '', known)).toEqual({ list: ['files', 'diff'], open: true });
    expect(parseRightSide(raw, 'p', known)).toEqual({ list: [] });
    expect(parseRightSide(null, '', known)).toEqual({ list: [] });
  });
});
