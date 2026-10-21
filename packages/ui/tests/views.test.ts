import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSettingsRegistry, groupField, str } from '../src/settings-schema';
import { createViews, defineView, settingDefaultsOf, useViewLink, useViewRequest } from '../src/views';

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

  test('allows a duplicate key with identical text', () => {
    const v = createViews([view('a', 'g', 1, { shared: 'x' }), view('b', 'g', 2, { shared: 'x' })]);
    expect(v.messages.en.shared).toBe('x');
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

describe('view links', () => {
  const probe = (id: string, taken?: unknown[]) => () => {
    const { request, take } = useViewRequest<{ n: number }>(id);
    if (request && taken) taken.push(take());
    return createElement('i', null, request ? `got${request.n}` : 'none');
  };

  test('link stores the payload, navigates and is taken once', () => {
    const v = createViews([view('a', 'g', 1), view('b', 'g', 2)]);
    const went: string[] = [];
    const taken: unknown[] = [];
    const Probe = probe('b', taken);
    const render = () => renderToStaticMarkup(createElement(v.Providers, { settings: {}, go: (id) => went.push(id), children: createElement(Probe) }));
    expect(render()).toBe('<i>none</i>');
    v.link('b', { n: 1 });
    expect(went).toEqual(['b']);
    expect(render()).toBe('<i>got1</i>');
    expect(taken).toEqual([{ n: 1 }]);
    expect(render()).toBe('<i>none</i>');
  });

  test('link to an unknown view does nothing', () => {
    const v = createViews([view('a', 'g', 1)]);
    const went: string[] = [];
    renderToStaticMarkup(createElement(v.Providers, { settings: {}, go: (id) => went.push(id), children: null }));
    v.link('zzz', { n: 1 });
    expect(went).toEqual([]);
  });

  test('useViewLink is null for an absent view, a function for a present one', () => {
    const v = createViews([view('a', 'g', 1)]);
    const seen: Array<boolean> = [];
    const Probe = () => {
      seen.push(useViewLink('a') !== null, useViewLink('zzz') !== null);
      return null;
    };
    renderToStaticMarkup(createElement(v.Providers, { settings: {}, children: createElement(Probe) }));
    expect(seen).toEqual([true, false]);
    renderToStaticMarkup(createElement(Probe));
    expect(seen.slice(2)).toEqual([false, false]);
  });
});
