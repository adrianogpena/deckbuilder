import { describe, expect, test } from 'bun:test';
import { ICON_SET_IDS, LAYOUTS } from '@deckbuilder/server-core/layouts';
import { ICON_SETS, PATHS, iconSetById } from '../src/icons';

describe('icon sets', () => {
  test('registered ids match the server list', () => {
    expect(Object.keys(ICON_SETS).sort()).toEqual([...ICON_SET_IDS].sort());
  });

  test.each(Object.values(ICON_SETS))('$id covers exactly the icon names', (set) => {
    expect(Object.keys(set.paths).sort()).toEqual(Object.keys(PATHS).sort());
    for (const d of Object.values(set.paths)) expect(d.length).toBeGreaterThan(0);
  });

  test('every layout names a registered set', () => {
    for (const l of LAYOUTS) expect(ICON_SETS[l.icons]).toBeDefined();
  });

  test('unknown id falls back to original', () => {
    expect(iconSetById('nope').id).toBe('original');
  });
});
