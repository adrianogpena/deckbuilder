import { describe, expect, test } from 'bun:test';
import { DEFAULT_SECTIONS, createSettingsRegistry, isModified, registerDefaultSections, resetPatch, type SettingDef } from '../src/settings-schema.ts';

interface S {
  autostart: boolean;
  nested?: { rows?: number };
}

const sample = (): SettingDef<S>[] => [
  { id: 'general.autostart', kind: 'boolean', section: ['general'], order: 10, label: 'a', default: false, get: (s) => s.autostart, set: (_, autostart) => ({ autostart }) },
  {
    id: 'workbench.rows',
    kind: 'number',
    section: ['workbench'],
    order: 20,
    label: 'b',
    default: 1000,
    get: (s) => s.nested?.rows ?? 1000,
    set: (s, rows) => ({ nested: { ...s.nested, rows } }),
  },
  { id: 'general.list', kind: 'custom', section: ['general'], order: 5, default: [] as string[] },
];

const registry = () => {
  const r = createSettingsRegistry<S>();
  r.registerSettings(sample());
  return r;
};

describe('settings registry', () => {
  test('defaults resolve by id', () => {
    const r = registry();
    expect(r.setting('general.autostart')!.default).toBe(false);
    expect(r.setting('workbench.rows')!.default).toBe(1000);
    expect(r.setting('missing')).toBeUndefined();
  });

  test('getters fall back to the default on an empty settings object', () => {
    const def = registry().setting('workbench.rows') as Extract<SettingDef<S>, { kind: 'number' }>;
    expect(def.get({ autostart: false })).toBe(def.default);
  });

  test('set patch round-trips through get', () => {
    const r = registry();
    const rows = r.setting('workbench.rows') as Extract<SettingDef<S>, { kind: 'number' }>;
    const auto = r.setting('general.autostart') as Extract<SettingDef<S>, { kind: 'boolean' }>;
    const base: S = { autostart: false };
    expect(auto.get({ ...base, ...auto.set(base, true) })).toBe(true);
    expect(rows.get({ ...base, ...rows.set(base, 50) })).toBe(50);
  });

  test('isModified and resetPatch follow the default', () => {
    const def = registry().setting('general.autostart')!;
    expect(isModified(def, { autostart: false })).toBe(false);
    expect(isModified(def, { autostart: true })).toBe(true);
    expect(resetPatch(def, { autostart: true })).toEqual({ autostart: false });
    expect(resetPatch(registry().setting('general.list')!, { autostart: true })).toBeUndefined();
  });

  test('duplicate ids are rejected and ids are unique', () => {
    const r = registry();
    expect(() => r.registerSetting(sample()[0]!)).toThrow('already registered');
    const ids = r.settings().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('settingsIn sorts by order and filters by section', () => {
    const r = registry();
    expect(r.settingsIn(['general']).map((s) => s.id)).toEqual(['general.list', 'general.autostart']);
    expect(r.settingsIn([], true)).toHaveLength(3);
  });
});

describe('default sections', () => {
  test('paths are unique and the tree nests children', () => {
    const keys = DEFAULT_SECTIONS.map((s) => s.path.join('.'));
    expect(new Set(keys).size).toBe(keys.length);
    const r = createSettingsRegistry<S>();
    registerDefaultSections(r);
    const workbench = r.sectionTree().find((n) => n.path[0] === 'workbench')!;
    expect(workbench.children.map((c) => c.path.join('.'))).toEqual(['workbench.results', 'workbench.sqlFormatter']);
  });
});
