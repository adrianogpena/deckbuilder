import { describe, expect, test } from 'bun:test';
import { filterPalette, type PaletteItem } from '../src/palette.ts';

const item = (id: string, label: string, keywords?: string[]): PaletteItem => ({ id, group: 'g', label, keywords, run() {} });
const ids = (items: PaletteItem[]) => items.map((i) => i.id);

describe('filterPalette', () => {
  test('empty query keeps order and applies the limit', () => {
    const items = [item('a', 'Alpha'), item('b', 'Beta'), item('c', 'Gamma')];
    expect(ids(filterPalette(items, '  '))).toEqual(['a', 'b', 'c']);
    expect(ids(filterPalette(items, '', 2))).toEqual(['a', 'b']);
  });

  test('ranks exact keyword, keyword prefix, label prefix, keyword substring, label substring', () => {
    const items = [
      item('label-sub', 'Open pods list'),
      item('kw-sub', 'Zzz', ['xpodsx']),
      item('label-prefix', 'Pods overview'),
      item('kw-prefix', 'Yyy', ['podsy']),
      item('kw-exact', 'Xxx', ['pods']),
    ];
    expect(ids(filterPalette(items, 'pods'))).toEqual(['kw-exact', 'kw-prefix', 'label-prefix', 'kw-sub', 'label-sub']);
  });

  test('ignores a leading colon and case', () => {
    const items = [item('a', 'Nord'), item('b', 'Other')];
    expect(ids(filterPalette(items, ':NORD'))).toEqual(['a']);
  });

  test('head word narrows to the item whose first keyword matches', () => {
    const items = [item('ns-a', 'prod', ['ns']), item('ns-b', 'dev', ['ns']), item('other', 'prod', ['ctx'])];
    expect(ids(filterPalette(items, 'ns pro'))).toEqual(['ns-a']);
  });

  test('items without keywords match on the label only', () => {
    expect(ids(filterPalette([item('a', 'Quit')], 'qui'))).toEqual(['a']);
  });

  test('limit applies after sorting', () => {
    const items = [item('a', 'xa'), item('b', 'ab'), item('c', 'ac')];
    expect(ids(filterPalette(items, 'a', 2))).toEqual(['b', 'c']);
  });
});
