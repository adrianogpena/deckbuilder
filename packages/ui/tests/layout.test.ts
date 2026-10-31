import { describe, expect, test } from 'bun:test';
import { ICON_SET_IDS, ORIGINAL_STRUCTURE, resolveIconSetId, resolveLayout } from '@kedalion/server-core/layouts';

describe('layouts', () => {
  test('resolveLayout falls back to the default layout', () => {
    expect(resolveLayout().id).toBe('ribbon');
    expect(resolveLayout('nope').id).toBe('ribbon');
  });

  test('original structure', () => {
    expect(resolveLayout('original').structure).toEqual(ORIGINAL_STRUCTURE);
  });

  test('resolveIconSetId prefers a known override', () => {
    const layout = resolveLayout();
    expect(resolveIconSetId(layout)).toBe('atom');
    expect(resolveIconSetId(layout, 'nope')).toBe('atom');
    expect(resolveIconSetId(layout, ICON_SET_IDS[0])).toBe(ICON_SET_IDS[0]);
  });
});
