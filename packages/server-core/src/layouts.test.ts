import { expect, test } from 'bun:test';
import { DEFAULT_LAYOUT, LAYOUTS, resolveLayout } from './layouts.ts';

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
