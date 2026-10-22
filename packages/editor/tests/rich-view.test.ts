import { describe, expect, test } from 'bun:test';
import { clampZoom, readingWidthCss, stepZoom } from '../src/rich/view.ts';

describe('zoom', () => {
  test('clamps to 50-200 and snaps to 10', () => {
    expect(clampZoom(10)).toBe(50);
    expect(clampZoom(500)).toBe(200);
    expect(clampZoom(104)).toBe(100);
    expect(clampZoom(Number.NaN)).toBe(100);
  });
  test('steps by 10 within the range', () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(50, -1)).toBe(50);
    expect(stepZoom(200, 1)).toBe(200);
  });
});

describe('readingWidthCss', () => {
  test('keywords and numbers', () => {
    expect(readingWidthCss('comfortable')).toBe('72ch');
    expect(readingWidthCss('full')).toBe('none');
    expect(readingWidthCss(60)).toBe('60ch');
    expect(readingWidthCss(10)).toBe('40ch');
    expect(readingWidthCss(500)).toBe('120ch');
    expect(readingWidthCss('70%')).toBe('max(min(72ch, 100%), 70%)');
    expect(readingWidthCss('10%')).toBe('max(min(72ch, 100%), 50%)');
  });
});
