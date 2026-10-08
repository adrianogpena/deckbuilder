import { describe, expect, test } from 'bun:test';
import { firstChildId, isInside, nextId, parentId, prevId, subtreeIds, visibleRows } from '../src/tree.ts';

interface Node {
  id: string;
}

const n = (id: string): Node => ({ id });
const children: Record<string, Node[]> = {
  a: [n('a1'), n('a2')],
  a1: [n('a1x')],
  b: [n('b1')],
};
const roots = [n('a'), n('b'), n('c')];
const rowsFor = (expanded: string[]) => visibleRows(roots, (id) => children[id], new Set(expanded), (x) => x.id);

describe('visibleRows', () => {
  test('collapsed tree shows only the roots', () => {
    expect(rowsFor([]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('expanded nodes show their children with depth and parent', () => {
    const rows = rowsFor(['a', 'a1', 'b']);
    expect(rows.map((r) => [r.id, r.depth, r.parentId])).toEqual([
      ['a', 0, null],
      ['a1', 1, 'a'],
      ['a1x', 2, 'a1'],
      ['a2', 1, 'a'],
      ['b', 0, null],
      ['b1', 1, 'b'],
      ['c', 0, null],
    ]);
  });

  test('an expanded node under a collapsed parent stays hidden', () => {
    expect(rowsFor(['a1']).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('an expanded node with unknown children shows no children', () => {
    expect(rowsFor(['c']).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('moves', () => {
  const rows = rowsFor(['a', 'a1']);

  test('next and prev cross levels', () => {
    expect(nextId(rows, 'a1x')).toBe('a2');
    expect(nextId(rows, 'a2')).toBe('b');
    expect(prevId(rows, 'b')).toBe('a2');
    expect(prevId(rows, 'a2')).toBe('a1x');
  });

  test('null at the ends and for unknown ids', () => {
    expect(prevId(rows, 'a')).toBeNull();
    expect(nextId(rows, 'c')).toBeNull();
    expect(nextId(rows, 'zzz')).toBeNull();
    expect(prevId(rows, 'zzz')).toBeNull();
  });

  test('parentId', () => {
    expect(parentId(rows, 'a')).toBeNull();
    expect(parentId(rows, 'a1x')).toBe('a1');
    expect(parentId(rows, 'zzz')).toBeNull();
  });

  test('firstChildId only for an expanded row with visible children', () => {
    expect(firstChildId(rows, 'a')).toBe('a1');
    expect(firstChildId(rows, 'a2')).toBeNull();
    expect(firstChildId(rows, 'b')).toBeNull();
  });

  test('isInside follows the parent chain', () => {
    expect(isInside(rows, 'a1x', 'a')).toBe(true);
    expect(isInside(rows, 'a', 'a')).toBe(true);
    expect(isInside(rows, 'a', 'a1')).toBe(false);
    expect(isInside(rows, 'b', 'a')).toBe(false);
  });
});

describe('subtreeIds', () => {
  const cache = new Map<string, { id: string }[]>([
    ['a', [{ id: 'a/b' }, { id: 'a/c' }]],
    ['a/b', [{ id: 'a/b/d' }]],
  ]);
  const ids = (given: string[]) => subtreeIds(given, (id) => cache.get(id), (n) => n.id).sort();

  test('adds every cached descendant', () => {
    expect(ids(['a'])).toEqual(['a', 'a/b', 'a/b/d', 'a/c']);
  });

  test('keeps ids without cached children and handles none', () => {
    expect(ids(['x'])).toEqual(['x']);
    expect(ids([])).toEqual([]);
  });
});
