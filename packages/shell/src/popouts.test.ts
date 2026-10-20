import { describe, expect, test } from 'bun:test';
import { createPopouts, parsePopoutBody } from './popouts.ts';

describe('parsePopoutBody', () => {
  test('accepts a view id and a title', () => {
    expect(parsePopoutBody({ view: 'explorer', title: 'Explorer' })).toEqual({ view: 'explorer', title: 'Explorer' });
    expect(parsePopoutBody({ view: 'a.b-c_1', title: '' })).toEqual({ view: 'a.b-c_1', title: '' });
  });

  test('rejects bad views, titles and bodies', () => {
    expect(parsePopoutBody({ view: 'a/b', title: 'x' })).toBeUndefined();
    expect(parsePopoutBody({ view: '', title: 'x' })).toBeUndefined();
    expect(parsePopoutBody({ view: 'a', title: 'x'.repeat(201) })).toBeUndefined();
    expect(parsePopoutBody({ view: 'a', title: 5 })).toBeUndefined();
    expect(parsePopoutBody({ view: 1, title: 'x' })).toBeUndefined();
    expect(parsePopoutBody(null)).toBeUndefined();
    expect(parsePopoutBody('x')).toBeUndefined();
  });
});

describe('createPopouts', () => {
  test('tracks views and removes only the current handle', () => {
    const p = createPopouts<object>();
    const a = {};
    const b = {};
    p.add('x', a);
    expect(p.get('x')).toBe(a);
    expect(p.views()).toEqual(['x']);
    p.remove('x', b);
    expect(p.views()).toEqual(['x']);
    p.remove('x', a);
    expect(p.views()).toEqual([]);
  });
});
