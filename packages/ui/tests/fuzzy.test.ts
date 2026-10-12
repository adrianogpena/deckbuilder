import { describe, expect, test } from 'bun:test';
import { fuzzyPath, fuzzyScore, highlightRuns } from '../src/fuzzy';

describe('fuzzyScore', () => {
  test('misses when a character is absent or out of order', () => {
    expect(fuzzyScore('xyz', 'abc')).toBeUndefined();
    expect(fuzzyScore('ba', 'ab')).toBeUndefined();
  });

  test('empty query matches', () => {
    expect(fuzzyScore('', 'abc')).toEqual({ score: 0, positions: [] });
  });

  test('returns the matched positions', () => {
    expect(fuzzyScore('exscr', 'ExplorerScreen.tsx')?.positions).toEqual([0, 1, 8, 9, 10]);
  });

  test('contiguous beats scattered', () => {
    expect(fuzzyScore('tab', 'tabs.ts')!.score).toBeGreaterThan(fuzzyScore('tab', 'tree-abstract')!.score);
  });

  test('word starts beat mid-word', () => {
    expect(fuzzyScore('fs', 'file-settings')!.score).toBeGreaterThan(fuzzyScore('fs', 'offsets')!.score);
  });

  test('matching case scores higher', () => {
    expect(fuzzyScore('Tab', 'Tab')!.score).toBeGreaterThan(fuzzyScore('tab', 'Tab')!.score);
  });
});

describe('fuzzyPath', () => {
  test('a name match beats a path-only match', () => {
    const byName = fuzzyPath('tabs', 'src/tabs.ts')!;
    const byPath = fuzzyPath('tabs', 'tabs/src/index.ts')!;
    expect(byName.score).toBeGreaterThan(byPath.score);
  });

  test('positions index into the whole path', () => {
    expect(fuzzyPath('tabs', 'src/tabs.ts')?.positions).toEqual([4, 5, 6, 7]);
  });

  test('a query with a slash matches the path', () => {
    expect(fuzzyPath('ui/tabs', 'packages/ui/src/tabs.ts')).toBeDefined();
    expect(fuzzyPath('ui/tabs', 'tabs.ts')).toBeUndefined();
  });

  test('empty query matches everything', () => {
    expect(fuzzyPath('  ', 'a/b')?.score).toBe(0);
  });
});

test('highlightRuns groups characters', () => {
  expect(highlightRuns('abcd', [1, 2])).toEqual([
    { text: 'a', hit: false },
    { text: 'bc', hit: true },
    { text: 'd', hit: false },
  ]);
});
