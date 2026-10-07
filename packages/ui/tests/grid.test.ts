import { describe, expect, test } from 'bun:test';
import {
  COLLAPSED_H,
  addItem,
  breakpointOf,
  findFreeSpot,
  fromGridLayout,
  sameGeometry,
  toGridLayout,
  type GridItem,
  type PanelDef,
} from '../src/grid.ts';

const def = (id: string, w = 6, h = 8): PanelDef => ({ id, title: id, icon: 'cube', defaultSize: { w, h }, minW: 3, minH: 4 });
const defs = [def('a'), def('b'), def('c')];
const item = (id: string, x: number, y: number, w = 6, h = 8, collapsed?: boolean): GridItem => ({ id, x, y, w, h, collapsed });

describe('breakpointOf', () => {
  test('switches at 768 and 1200', () => {
    expect(breakpointOf(1920)).toBe('lg');
    expect(breakpointOf(1200)).toBe('lg');
    expect(breakpointOf(1199)).toBe('md');
    expect(breakpointOf(768)).toBe('md');
    expect(breakpointOf(767)).toBe('sm');
    expect(breakpointOf(0)).toBe('sm');
  });
});

describe('toGridLayout', () => {
  test('maps position, size and minimums from the definition', () => {
    expect(toGridLayout([item('a', 6, 8, 4, 5)], defs)).toEqual([
      { i: 'a', x: 6, y: 8, w: 4, h: 5, minW: 3, minH: 4, isResizable: true },
    ]);
  });

  test('a collapsed panel has a fixed height and cannot be resized', () => {
    const [l] = toGridLayout([item('a', 0, 0, 6, 8, true)], defs);
    expect(l).toMatchObject({ h: COLLAPSED_H, minH: COLLAPSED_H, isResizable: false });
  });

  test('unknown ids are dropped', () => {
    expect(toGridLayout([item('zzz', 0, 0), item('b', 6, 0)], defs).map((l) => l.i)).toEqual(['b']);
  });
});

describe('fromGridLayout', () => {
  test('round trip keeps the items', () => {
    const items = [item('a', 0, 0), item('b', 6, 0, 6, 10)];
    expect(fromGridLayout(toGridLayout(items, defs), items)).toEqual(items);
  });

  test('takes positions and sizes from the layout', () => {
    const items = [item('a', 0, 0)];
    const layout = [{ i: 'a', x: 3, y: 2, w: 5, h: 7 }];
    expect(fromGridLayout(layout, items)).toEqual([{ id: 'a', x: 3, y: 2, w: 5, h: 7, collapsed: undefined }]);
  });

  test('a collapsed panel keeps its expanded height and the flag', () => {
    const items = [item('a', 0, 0, 6, 8, true)];
    const next = fromGridLayout(toGridLayout(items, defs), items);
    expect(next[0]).toMatchObject({ h: 8, collapsed: true });
  });

  test('items missing from the layout stay as they are', () => {
    const items = [item('a', 0, 0), item('b', 6, 0)];
    expect(fromGridLayout([{ i: 'a', x: 1, y: 1, w: 6, h: 8 }], items)[1]).toBe(items[1]!);
  });
});

describe('sameGeometry', () => {
  test('compares id, position and size, not the collapsed flag', () => {
    expect(sameGeometry([item('a', 0, 0)], [item('a', 0, 0, 6, 8, true)])).toBe(true);
    expect(sameGeometry([item('a', 0, 0)], [item('a', 1, 0)])).toBe(false);
    expect(sameGeometry([item('a', 0, 0)], [])).toBe(false);
  });
});

describe('findFreeSpot / addItem', () => {
  test('empty grid: the origin', () => {
    expect(findFreeSpot([], 6, 8)).toEqual({ x: 0, y: 0 });
  });

  test('fills the gap beside a panel before going lower', () => {
    expect(findFreeSpot([item('a', 0, 0)], 6, 8)).toEqual({ x: 6, y: 0 });
  });

  test('fills a gap before appending at the bottom', () => {
    const items = [item('a', 0, 0), item('b', 6, 0, 6, 4), item('c', 0, 8)];
    expect(findFreeSpot(items, 6, 4)).toEqual({ x: 6, y: 4 });
    expect(addItem(items, def('d', 6, 4)).at(-1)).toEqual({ id: 'd', x: 6, y: 4, w: 6, h: 4, collapsed: false });
  });

  test('appends below when nothing fits', () => {
    const items = [item('a', 0, 0), item('b', 6, 0)];
    expect(findFreeSpot(items, 6, 8)).toEqual({ x: 0, y: 8 });
  });

  test('a panel wider than the grid is clamped', () => {
    expect(findFreeSpot([], 20, 4)).toEqual({ x: 0, y: 0 });
  });
});
