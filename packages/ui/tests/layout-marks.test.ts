import { describe, expect, test } from 'bun:test';
import { LAYOUT_MARK_IDS, layoutMarkSvg } from '../src/layout-marks';

describe('layout marks', () => {
  test('has a mark for every designed layout', () => {
    expect([...LAYOUT_MARK_IDS].sort()).toEqual(['atlas', 'blueprint', 'calm', 'dense', 'dock-right', 'islands', 'labeled', 'ledger', 'material', 'modeline', 'original', 'ribbon', 'transit']);
  });

  test('unknown layouts fall back to the stack mark', () => {
    expect(layoutMarkSvg('nope', 'x')).toBe(layoutMarkSvg('original', 'x'));
  });

  test('mask ids use the given prefix', () => {
    const svg = layoutMarkSvg('calm', 'abc');
    expect(svg).toContain('id="abc-0"');
    expect(svg).toContain('url(#abc-0)');
    expect(svg).not.toContain('calm-');
  });
});
