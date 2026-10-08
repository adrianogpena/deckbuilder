import { describe, expect, test } from 'bun:test';
import { cellText, nextSort, select, sortRows, toCsv, toTsv, visibleRange } from '../src/table.ts';

describe('cellText', () => {
  test('formats each kind of value', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(cellText(false)).toBe('false');
    expect(cellText(5)).toBe('5');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText('x')).toBe('x');
  });
});

describe('sortRows', () => {
  const id = (v: unknown) => v;

  test('sorts numbers natively and strings naturally', () => {
    expect(sortRows([10, 2, 33], id, 'asc')).toEqual([2, 10, 33]);
    expect(sortRows(['item 10', 'item 2', 'Item 1'], id, 'asc')).toEqual(['Item 1', 'item 2', 'item 10']);
    expect(sortRows([1, 3, 2], id, 'desc')).toEqual([3, 2, 1]);
  });

  test('puts null and undefined last in both directions', () => {
    expect(sortRows([null, 2, undefined, 1], id, 'asc')).toEqual([1, 2, null, undefined]);
    expect(sortRows([null, 2, undefined, 1], id, 'desc')).toEqual([2, 1, null, undefined]);
  });

  test('is stable for equal values in both directions', () => {
    const rows = [
      { k: 1, n: 'a' },
      { k: 1, n: 'b' },
      { k: 0, n: 'c' },
      { k: 1, n: 'd' },
    ];
    expect(sortRows(rows, (r) => r.k, 'asc').map((r) => r.n)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortRows(rows, (r) => r.k, 'desc').map((r) => r.n)).toEqual(['a', 'b', 'd', 'c']);
  });

  test('orders dates by time and booleans false before true', () => {
    expect(sortRows([new Date(2000, 0, 2), new Date(2000, 0, 1)], id, 'asc')).toEqual([new Date(2000, 0, 1), new Date(2000, 0, 2)]);
    expect(sortRows([true, false], id, 'asc')).toEqual([false, true]);
  });

  test('does not mutate the input', () => {
    const rows = [2, 1];
    sortRows(rows, id, 'asc');
    expect(rows).toEqual([2, 1]);
  });
});

describe('nextSort', () => {
  test('cycles asc, desc, none on one column', () => {
    const a = nextSort(null, 'x');
    expect(a).toEqual({ column: 'x', dir: 'asc' });
    const d = nextSort(a, 'x');
    expect(d).toEqual({ column: 'x', dir: 'desc' });
    expect(nextSort(d, 'x')).toBeNull();
  });

  test('another column starts at asc', () => {
    expect(nextSort({ column: 'x', dir: 'desc' }, 'y')).toEqual({ column: 'y', dir: 'asc' });
  });
});

describe('visibleRange', () => {
  test('at the top', () => {
    expect(visibleRange(0, 280, 28, 1000)).toEqual({ start: 0, end: 18 });
  });

  test('in the middle', () => {
    expect(visibleRange(2800, 280, 28, 1000)).toEqual({ start: 92, end: 118 });
  });

  test('at the end it is clamped', () => {
    expect(visibleRange(27720, 280, 28, 1000)).toEqual({ start: 982, end: 1000 });
  });

  test('beyond the end and empty tables stay valid', () => {
    expect(visibleRange(99999, 280, 28, 10)).toEqual({ start: 10, end: 10 });
    expect(visibleRange(0, 280, 28, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('toCsv', () => {
  const cols = [
    { label: 'name', value: (r: { n: unknown; v: unknown }) => r.n },
    { label: 'value', value: (r: { n: unknown; v: unknown }) => r.v },
  ];

  test('has a header and CRLF line ends', () => {
    expect(toCsv(cols, [{ n: 'a', v: 1 }])).toBe('name,value\r\na,1');
  });

  test('quotes commas, quotes and line breaks', () => {
    expect(toCsv(cols, [{ n: 'a,b', v: 'say "hi"' }, { n: 'x\ny', v: null }])).toBe('name,value\r\n"a,b","say ""hi"""\r\n"x\ny",');
  });

  test('prefixes formula-looking strings but not numbers', () => {
    expect(toCsv(cols, [{ n: '=SUM(A1)', v: -5 }])).toBe("name,value\r\n'=SUM(A1),-5");
    expect(toCsv(cols, [{ n: '@x', v: '+1' }, { n: '\tx', v: '-a' }])).toBe("name,value\r\n'@x,'+1\r\n'\tx,'-a");
  });
});

describe('toTsv', () => {
  test('replaces tabs and newlines inside cells', () => {
    const cols = [{ label: 'a', value: (r: string) => r }];
    expect(toTsv(cols, ['x\ty', 'p\nq'])).toBe('a\nx y\np q');
  });
});

describe('select', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];

  test('single replaces the selection', () => {
    expect(select({ keys: ['a'], anchor: 'a' }, 'c', keys, 'single')).toEqual({ keys: ['c'], anchor: 'c' });
  });

  test('toggle adds and removes', () => {
    const added = select({ keys: ['a'], anchor: 'a' }, 'c', keys, 'toggle');
    expect(added).toEqual({ keys: ['a', 'c'], anchor: 'c' });
    expect(select(added, 'a', keys, 'toggle')).toEqual({ keys: ['c'], anchor: 'a' });
  });

  test('range spans anchor to target in either direction and keeps the anchor', () => {
    expect(select({ keys: ['b'], anchor: 'b' }, 'd', keys, 'range')).toEqual({ keys: ['b', 'c', 'd'], anchor: 'b' });
    expect(select({ keys: ['d'], anchor: 'd' }, 'b', keys, 'range')).toEqual({ keys: ['b', 'c', 'd'], anchor: 'd' });
  });

  test('range without a usable anchor acts as single', () => {
    expect(select({ keys: [], anchor: null }, 'c', keys, 'range')).toEqual({ keys: ['c'], anchor: 'c' });
    expect(select({ keys: ['z'], anchor: 'z' }, 'c', keys, 'range')).toEqual({ keys: ['c'], anchor: 'c' });
  });
});
