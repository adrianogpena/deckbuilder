import { describe, expect, test } from 'bun:test';
import { CLOCK_SPEC } from '../clock-fields';
import { activeLayout, defaultLayouts, layoutsOrDefault, newLayoutId, validDashboardLayouts, validDashboardPresets } from './model';

const kinds = { clock: CLOCK_SPEC };
const item = { id: 'clock', kind: 'clock', x: 0, y: 0, w: 3, h: 4 };
const layout = (id: string, name = 'L', items: unknown[] = []) => ({ id, name, items });

describe('validDashboardLayouts', () => {
  test('accepts a valid state and cleans items', () => {
    const v = validDashboardLayouts({ active: 'b', layouts: [layout('a'), layout('b', ' Two ', [{ ...item, config: { hour12: 'x', junk: 1 } }])] }, kinds);
    expect(v?.active).toBe('b');
    expect(v?.layouts[1]?.name).toBe('Two');
    expect(v?.layouts[1]?.items[0]?.config).toEqual({ timeZone: '', hour12: false, showSeconds: true, showDate: true });
  });

  test('rejects bad shapes', () => {
    expect(validDashboardLayouts(null, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'zz', layouts: [layout('a')] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a'), layout('a')] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a', '')] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a', 'x'.repeat(41))] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a', 'L', [{ ...item, kind: 'nope' }])] }, kinds)).toBeNull();
  });

  test('allows 20 layouts, not 21', () => {
    const many = (n: number) => ({ active: 'l0', layouts: Array.from({ length: n }, (_, i) => layout(`l${i}`)) });
    expect(validDashboardLayouts(many(20), kinds)).not.toBeNull();
    expect(validDashboardLayouts(many(21), kinds)).toBeNull();
  });
});

describe('helpers', () => {
  test('default, fallback, active and new id', () => {
    const d = defaultLayouts('My dashboard');
    expect(d.layouts).toEqual([{ id: 'default', name: 'My dashboard', items: [] }]);
    expect(layoutsOrDefault(undefined, kinds, 'My dashboard')).toEqual(d);
    expect(activeLayout({ active: 'x', layouts: d.layouts }).id).toBe('default');
    expect(newLayoutId(d.layouts)).not.toBe('default');
  });
});

describe('validDashboardPresets', () => {
  const preset = { id: 'p1', name: 'Lisbon', kind: 'clock', config: { timeZone: 'Europe/Lisbon', junk: 1 }, w: 3, h: 4 };

  test('cleans config and drops unknown kinds and bad entries', () => {
    const v = validDashboardPresets([preset, { ...preset, id: 'p2', kind: 'nope' }, { ...preset, id: 'p3', name: '' }, { ...preset, id: 'p1' }, 5], kinds);
    expect(v).toEqual([{ id: 'p1', name: 'Lisbon', kind: 'clock', config: { timeZone: 'Europe/Lisbon', hour12: false, showSeconds: true, showDate: true }, w: 3, h: 4 }]);
  });

  test('rejects a non-list and more than 50', () => {
    expect(validDashboardPresets({}, kinds)).toBeNull();
    expect(validDashboardPresets(Array.from({ length: 51 }, (_, i) => ({ ...preset, id: `p${i}` })), kinds)).toBeNull();
  });
});
