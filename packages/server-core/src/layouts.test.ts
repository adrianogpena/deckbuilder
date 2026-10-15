import { expect, test } from 'bun:test';
import { applyMainMenu, DEFAULT_LAYOUT, hasLabelledMenu, LAYOUTS, ORIGINAL_STRUCTURE, resolveLayout } from './layouts.ts';

test('layout ids are unique and include the default', () => {
  const ids = LAYOUTS.map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(DEFAULT_LAYOUT);
});

test('resolveLayout falls back to the default', () => {
  expect(resolveLayout().id).toBe(DEFAULT_LAYOUT);
  expect(resolveLayout('nope').id).toBe(DEFAULT_LAYOUT);
  expect(resolveLayout('original').id).toBe('original');
});

test('hasLabelledMenu is true only for an expanded sidebar', () => {
  expect(hasLabelledMenu(ORIGINAL_STRUCTURE)).toBe(false);
  expect(hasLabelledMenu({ ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded' })).toBe(true);
});

test('applyMainMenu collapses an expanded sidebar for icons only', () => {
  const expanded = { ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded' as const };
  const icons = applyMainMenu(expanded, 'icons');
  expect(icons.sidebarMode).toBe('collapsed');
  expect(icons).not.toBe(expanded);
  expect(expanded.sidebarMode).toBe('expanded');
  expect(applyMainMenu(expanded, 'labels')).toBe(expanded);
  expect(applyMainMenu(expanded)).toBe(expanded);
  expect(applyMainMenu(ORIGINAL_STRUCTURE, 'icons')).toBe(ORIGINAL_STRUCTURE);
});
