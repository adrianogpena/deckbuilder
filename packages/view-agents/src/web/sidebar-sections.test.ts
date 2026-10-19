import { describe, expect, test } from 'bun:test';
import { DEFAULT_SECTIONS, hideSection, loadSections, moveSection, normalizeSections, restoreAll, restoreSection, saveSections, sectionOrder, SECTIONS_KEY, toggleSection } from './sidebar-sections';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('sidebar sections', () => {
  test('toggle collapses and expands', () => {
    const a = toggleSection(DEFAULT_SECTIONS, 'tags');
    expect(a.collapsed).toContain('tags');
    expect(toggleSection(a, 'tags').collapsed).not.toContain('tags');
    expect(toggleSection(DEFAULT_SECTIONS, 'archived').collapsed).not.toContain('archived');
  });

  test('hide, restore one, restore all', () => {
    const a = hideSection(hideSection(DEFAULT_SECTIONS, 'tags'), 'usage');
    expect(a.hidden).toEqual(['tags', 'usage']);
    expect(restoreSection(a, 'tags').hidden).toEqual(['usage']);
    expect(restoreAll(a).hidden).toEqual([]);
  });

  test('move sets an explicit order', () => {
    expect(sectionOrder(DEFAULT_SECTIONS)).toEqual(['sessions', 'tags', 'archived', 'usage']);
    expect(sectionOrder(DEFAULT_SECTIONS, true)[0]).toBe('usage');
    const a = moveSection(DEFAULT_SECTIONS, 'usage', 0);
    expect(a.order).toEqual(['usage', 'sessions', 'tags', 'archived']);
    expect(moveSection(a, 'usage', 99).order).toEqual(['sessions', 'tags', 'archived', 'usage']);
  });

  test('normalize drops unknown ids and completes the order', () => {
    expect(normalizeSections({ order: ['tags', 'bogus'], collapsed: [], hidden: ['x', 'usage'] })).toEqual({ order: ['tags', 'sessions', 'archived', 'usage'], collapsed: [], hidden: ['usage'] });
    expect(normalizeSections(null)).toEqual(DEFAULT_SECTIONS);
  });

  test('save and load round trip; bad JSON and throwing storage fall back', () => {
    const s = memory();
    const a = hideSection(DEFAULT_SECTIONS, 'tags');
    saveSections(a, s);
    expect(loadSections(s)).toEqual(a);
    s.m.set(SECTIONS_KEY, '{');
    expect(loadSections(s)).toEqual(DEFAULT_SECTIONS);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadSections(broken)).toEqual(DEFAULT_SECTIONS);
    expect(() => saveSections(a, broken)).not.toThrow();
  });
});
