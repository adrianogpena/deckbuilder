import { describe, expect, test } from 'bun:test';
import { createSettingsRegistry, groupField, str } from '../src/settings-schema';
import { createViews, defineView, settingDefaultsOf } from '../src/views';

type S = { demo?: { name?: string } };

const view = (id: string, group: string, order: number, extra: Record<string, string> = {}) =>
  defineView<string, S>({
    id,
    nav: { group, icon: 'home' as any, label: `${id}.label`, order },
    render: () => null,
    messages: { en: { [`${id}.label`]: id.toUpperCase(), ...extra }, 'pt-BR': { [`${id}.label`]: id, ...extra } },
  });

const props = { settings: {}, onSave() {}, go() {} };

describe('createViews', () => {
  test('nav groups in first-seen order, items by order', () => {
    const v = createViews([view('c', 'g2', 30), view('a', 'g1', 10), view('b', 'g2', 20), view('d', 'g1', 40)]);
    expect(v.nav.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['g1', ['a', 'd']],
      ['g2', ['b', 'c']],
    ]);
    expect(v.ids).toEqual(['c', 'a', 'b', 'd']);
  });

  test('unknown id: has false, render null', () => {
    const v = createViews([view('a', 'g', 1)]);
    expect(v.has('a')).toBe(true);
    expect(v.has('zzz')).toBe(false);
    expect(v.render('zzz', props)).toBeNull();
    expect(v.render('a', props)).not.toBeNull();
  });

  test('merges messages and throws on a duplicate key', () => {
    const v = createViews([view('a', 'g', 1), view('b', 'g', 2)]);
    expect(v.messages.en).toEqual({ 'a.label': 'A', 'b.label': 'B' });
    expect(() => createViews([view('a', 'g', 1, { shared: 'x' }), view('b', 'g', 2, { shared: 'y' })])).toThrow('Duplicate message key');
  });

  test('throws on a duplicate id', () => {
    expect(() => createViews([view('a', 'g', 1), view('a', 'g', 2)])).toThrow('already registered');
  });

  test('registers view settings and reads defaults', () => {
    const defs = [groupField<S, 'demo'>('demo', 'name', 10, str('x'))];
    const v = createViews([{ ...view('a', 'g', 1), settings: { defs } }]);
    const registry = createSettingsRegistry<S>();
    v.registerSettings(registry);
    expect(registry.setting('demo.name')?.default).toBe('x');
    expect(settingDefaultsOf(defs, 'demo')).toEqual({ name: 'x' });
  });
});
