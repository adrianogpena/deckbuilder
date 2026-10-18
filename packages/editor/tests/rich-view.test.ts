import { describe, expect, test } from 'bun:test';
import { clampZoom, fitZoom, readingWidthCss, stepZoom } from '../src/rich/view.ts';

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
  test('fit picks the largest step that fits', () => {
    expect(fitZoom(100, 1000, 700)).toBe(70);
    expect(fitZoom(100, 400, 700)).toBe(175 - 5);
    expect(fitZoom(100, 5000, 500)).toBe(50);
    expect(fitZoom(120, 0, 500)).toBe(120);
  });
});

describe('readingWidthCss', () => {
  test('keywords and numbers', () => {
    expect(readingWidthCss('comfortable')).toBe('72ch');
    expect(readingWidthCss('full')).toBe('none');
    expect(readingWidthCss(60)).toBe('60ch');
    expect(readingWidthCss(10)).toBe('40ch');
    expect(readingWidthCss(500)).toBe('120ch');
  });
});
