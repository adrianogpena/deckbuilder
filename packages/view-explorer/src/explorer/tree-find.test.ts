import { describe, expect, test } from 'bun:test';
import { findInTree } from './tree-find';

const entries = [
  { path: 'src', kind: 'dir' as const },
  { path: 'src/tabs.ts', kind: 'file' as const },
  { path: 'src/deep', kind: 'dir' as const },
  { path: 'src/deep/tab-bar.tsx', kind: 'file' as const },
  { path: 'readme.md', kind: 'file' as const },
];

describe('findInTree', () => {
  test('empty query finds nothing', () => {
    expect(findInTree(' ', entries)).toBeUndefined();
  });

  test('matches names and counts the folders above them', () => {
    const r = findInTree('tab', entries)!;
    expect([...r.matches.keys()]).toEqual(['src/tabs.ts', 'src/deep/tab-bar.tsx']);
    expect(r.matches.get('src/tabs.ts')).toEqual([0, 1, 2]);
    expect(r.counts.get('src')).toBe(2);
    expect(r.counts.get('src/deep')).toBe(1);
    expect(r.counts.get('')).toBe(2);
  });

  test('letters must be adjacent, in order, ignoring case', () => {
    expect(findInTree('tbs', entries)!.order).toEqual([]);
    expect(findInTree('TAB-B', entries)!.order).toEqual(['src/deep/tab-bar.tsx']);
  });

  test('a query with a slash matches the path and highlights the name', () => {
    const r = findInTree('deep/tab', entries)!;
    expect([...r.matches.keys()]).toEqual(['src/deep/tab-bar.tsx']);
    expect(r.matches.get('src/deep/tab-bar.tsx')).toEqual([0, 1, 2]);
  });
});
