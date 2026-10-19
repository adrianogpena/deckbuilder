import { describe, expect, test } from 'bun:test';
import { DEFAULT_SECTIONS, dockTool, hideSection, isTreeSection, loadSections, moveSection, moveWithin, normalizeSections, restoreAll, restoreSection, saveSections, sectionOrder, SECTIONS_KEY, toggleSection } from './sidebar-sections';

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
    expect(a.hidden).toEqual(['changes', 'files', 'tags', 'usage']);
    expect(restoreSection(a, 'tags').hidden).toEqual(['changes', 'files', 'usage']);
    expect(restoreAll(a).hidden).toEqual([]);
  });

  test('move sets an explicit order', () => {
    expect(sectionOrder(DEFAULT_SECTIONS)).toEqual(['sessions', 'changes', 'files', 'tags', 'archived', 'usage']);
    expect(sectionOrder(DEFAULT_SECTIONS, true)[0]).toBe('usage');
    const a = moveSection(DEFAULT_SECTIONS, 'usage', 0);
    expect(a.order).toEqual(['usage', 'sessions', 'changes', 'files', 'tags', 'archived']);
    expect(moveSection(a, 'usage', 99).order).toEqual(['sessions', 'changes', 'files', 'tags', 'archived', 'usage']);
  });

  test('moveWithin keeps the tree and island areas apart', () => {
    const a = moveWithin(DEFAULT_SECTIONS, 'tags', 0);
    expect(sectionOrder(a).filter(isTreeSection)).toEqual(['tags', 'sessions', 'archived']);
    expect(sectionOrder(a).filter((x) => !isTreeSection(x))).toEqual(['changes', 'files', 'usage']);
  });

  test('normalize drops unknown ids and completes the order', () => {
    expect(normalizeSections({ order: ['tags', 'bogus'], collapsed: [], hidden: ['x', 'usage'] })).toEqual({ order: ['tags', 'sessions', 'changes', 'files', 'archived', 'usage'], collapsed: [], hidden: ['usage'], tools: [] });
    expect(normalizeSections(null)).toEqual(DEFAULT_SECTIONS);
  });

  test('docked tools: dock, order, undock, old state without tools', () => {
    const a = dockTool(DEFAULT_SECTIONS, 'json');
    expect(a.tools).toEqual(['json']);
    expect(sectionOrder(a).at(-1)).toBe('tool:json');
    expect(hideSection(moveSection(a, 'tool:json', 0), 'tool:json')).toEqual({ ...DEFAULT_SECTIONS, order: sectionOrder(DEFAULT_SECTIONS) });
    expect(dockTool(DEFAULT_SECTIONS, 'changes').hidden).toEqual(['files']);
    expect(normalizeSections({ collapsed: [], hidden: [] }).tools).toEqual([]);
    expect(normalizeSections({ tools: ['json', 'bogus'], order: ['tool:json', 'tool:task'] }).order?.[0]).toBe('tool:json');
    expect(normalizeSections({ tools: ['json'], order: ['tool:task'] }).order).not.toContain('tool:task');
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
