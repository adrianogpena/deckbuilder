import { describe, expect, test } from 'bun:test';
import {
  COLLAPSED_H,
  addItem,
  breakpointOf,
  findFreeSpot,
  fromGridLayout,
  sameGeometry,
  sameItems,
  toGridLayout,
  validConfig,
  validGridItems,
  type GridItem,
  type PanelField,
  type PanelDef,
} from '../src/grid.ts';

const def = (id: string, w = 6, h = 8): PanelDef => ({ id, title: id, icon: 'cube', defaultSize: { w, h }, minW: 3, minH: 4 });
const defs = [def('a'), def('b'), def('c')];
const item = (id: string, x: number, y: number, w = 6, h = 8, collapsed?: boolean): GridItem => ({ id, kind: id, x, y, w, h, collapsed });

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
    expect(fromGridLayout(layout, items)).toEqual([{ id: 'a', kind: 'a', x: 3, y: 2, w: 5, h: 7, collapsed: undefined }]);
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
    expect(addItem(items, def('d', 6, 4)).at(-1)).toEqual({ id: 'd', kind: 'd', x: 6, y: 4, w: 6, h: 4, collapsed: false });
  });

  test('appends below when nothing fits', () => {
    const items = [item('a', 0, 0), item('b', 6, 0)];
    expect(findFreeSpot(items, 6, 8)).toEqual({ x: 0, y: 8 });
  });

  test('a panel wider than the grid is clamped', () => {
    expect(findFreeSpot([], 20, 4)).toEqual({ x: 0, y: 0 });
  });
});

describe('validGridItems', () => {
  const ids = { a: {}, b: {}, c: {} };

  test('accepts a valid layout', () => {
    const layout = [item('a', 0, 0), item('b', 6, 0, 6, 8, true)];
    expect(validGridItems(layout, ids)).toEqual([{ id: 'a', kind: 'a', x: 0, y: 0, w: 6, h: 8 }, { id: 'b', kind: 'b', x: 6, y: 0, w: 6, h: 8, collapsed: true }]);
  });

  test('rejects an unknown id', () => {
    expect(validGridItems([item('z', 0, 0)], ids)).toBeNull();
  });

  test('rejects x + w beyond 12 columns', () => {
    expect(validGridItems([item('a', 8, 0, 6)], ids)).toBeNull();
  });

  test('rejects w = 0', () => {
    expect(validGridItems([item('a', 0, 0, 0)], ids)).toBeNull();
  });

  test('rejects a duplicate id', () => {
    expect(validGridItems([item('a', 0, 0), item('a', 6, 0)], ids)).toBeNull();
  });
});

describe('title and icon', () => {
  const ids = { a: {} };
  const base = { id: 'a', kind: 'a', x: 0, y: 0, w: 6, h: 8 };

  test('a valid title is trimmed and kept with the icon', () => {
    expect(validGridItems([{ ...base, title: '  Mine ', icon: 'cube' }], ids)).toEqual([{ ...base, title: 'Mine', icon: 'cube' }]);
  });

  test('an empty title is dropped, a title over 40 characters is invalid', () => {
    expect(validGridItems([{ ...base, title: '   ' }], ids)).toEqual([base]);
    expect(validGridItems([{ ...base, title: 'x'.repeat(41) }], ids)).toBeNull();
    expect(validGridItems([{ ...base, title: 5 }], ids)).toBeNull();
  });

  test('an unknown icon invalidates the layout', () => {
    expect(validGridItems([{ ...base, icon: 'nope' }], ids)).toBeNull();
    expect(validGridItems([{ ...base, icon: 3 }], ids)).toBeNull();
  });

  test('sameItems sees a rename, an icon change and a collapse; sameGeometry does not', () => {
    const a = [base as GridItem];
    expect(sameItems(a, [{ ...base }])).toBe(true);
    expect(sameItems(a, [{ ...base, title: 'X' }])).toBe(false);
    expect(sameItems(a, [{ ...base, icon: 'cube' }])).toBe(false);
    expect(sameItems(a, [{ ...base, collapsed: true }])).toBe(false);
    expect(sameGeometry(a, [{ ...base, title: 'X' }])).toBe(true);
  });
});

const fields: PanelField[] = [
  { key: 'zone', kind: 'string', label: 'l', default: '', maxLength: 10 },
  { key: 'on', kind: 'boolean', label: 'l', default: true },
  { key: 'n', kind: 'number', label: 'l', default: 5, min: 1, max: 10 },
  { key: 'mode', kind: 'enum', label: 'l', default: 'a', values: ['a', 'b'] },
];

describe('validConfig', () => {
  test('fills defaults for missing, non-object and unknown input', () => {
    const defaults = { zone: '', on: true, n: 5, mode: 'a' };
    expect(validConfig(fields, undefined)).toEqual(defaults);
    expect(validConfig(fields, 'x')).toEqual(defaults);
    expect(validConfig(fields, [])).toEqual(defaults);
    expect(validConfig([], { a: 1 })).toEqual({});
  });

  test('keeps valid values and drops unknown keys', () => {
    expect(validConfig(fields, { zone: 'UTC', on: false, n: 7, mode: 'b', extra: 1 })).toEqual({ zone: 'UTC', on: false, n: 7, mode: 'b' });
  });

  test('replaces wrong types and unlisted enum values with the default, clamps numbers', () => {
    expect(validConfig(fields, { zone: 3, on: 'yes', n: 'x', mode: 'z' })).toEqual({ zone: '', on: true, n: 5, mode: 'a' });
    expect(validConfig(fields, { n: 99 }).n).toBe(10);
    expect(validConfig(fields, { n: -4 }).n).toBe(1);
    expect(validConfig(fields, { n: NaN }).n).toBe(5);
    expect(validConfig(fields, { zone: 'x'.repeat(11) }).zone).toBe('');
  });
});

describe('kinds, config and migration', () => {
  const kinds = { clock: { fields }, solo: { allowMultiple: false } };
  const box = { x: 0, y: 0, w: 6, h: 8 };

  test('an item without kind uses its id as kind', () => {
    expect(validGridItems([{ id: 'solo', ...box }], kinds)).toEqual([{ id: 'solo', kind: 'solo', ...box }]);
  });

  test('several instances of a kind with their own ids and cleaned configs', () => {
    const out = validGridItems([{ id: 'c1', kind: 'clock', config: { zone: 'UTC', junk: 1 }, ...box }, { id: 'c2', kind: 'clock', ...box, x: 6 }], kinds);
    expect(out?.map((i) => i.config)).toEqual([{ zone: 'UTC', on: true, n: 5, mode: 'a' }, { zone: '', on: true, n: 5, mode: 'a' }]);
  });

  test('rejects an unknown kind, a repeated allowMultiple false kind and a non-object config', () => {
    expect(validGridItems([{ id: 'x', kind: 'nope', ...box }], kinds)).toBeNull();
    expect(validGridItems([{ id: 'a', kind: 'solo', ...box }, { id: 'b', kind: 'solo', ...box, x: 6 }], kinds)).toBeNull();
    expect(validGridItems([{ id: 'c', kind: 'clock', config: 'x', ...box }], kinds)).toBeNull();
  });

  test('sameItems compares kind and config', () => {
    const a: GridItem = { id: 'c', kind: 'clock', config: { on: true }, ...box };
    expect(sameItems([a], [{ ...a, config: { on: true } }])).toBe(true);
    expect(sameItems([a], [{ ...a, config: { on: false } }])).toBe(false);
    expect(sameItems([a], [{ ...a, kind: 'other' }])).toBe(false);
    expect(sameItems([{ ...a, config: undefined }], [{ ...a, config: {} }])).toBe(true);
  });

  test('addItem makes a unique id and keeps the config', () => {
    const items = addItem([], def('clock'), { on: true });
    const next = addItem(items, def('clock'));
    expect(next.map((i) => i.id)).toEqual(['clock', 'clock-2']);
    expect(items[0]!.config).toEqual({ on: true });
  });
});
