import { describe, expect, test } from 'bun:test';
import { ICON_SET_IDS, ORIGINAL_STRUCTURE, resolveIconSetId, resolveLayout } from '@deckbuilder/server-core/layouts';

describe('layouts', () => {
  test('resolveLayout falls back to original', () => {
    expect(resolveLayout().id).toBe('original');
    expect(resolveLayout('nope').id).toBe('original');
  });

  test('original structure', () => {
    expect(resolveLayout('original').structure).toEqual(ORIGINAL_STRUCTURE);
  });

  test('resolveIconSetId prefers a known override', () => {
    const layout = resolveLayout();
    expect(resolveIconSetId(layout)).toBe('original');
    expect(resolveIconSetId(layout, 'nope')).toBe('original');
    expect(resolveIconSetId(layout, ICON_SET_IDS[0])).toBe(ICON_SET_IDS[0]);
  });
});
