import { describe, expect, test } from 'bun:test';
import { activeHeading } from '../src/toc.ts';

describe('activeHeading', () => {
  test('no headings', () => {
    expect(activeHeading([], 16, false)).toBe(-1);
  });

  test('before the first heading the first one is active', () => {
    expect(activeHeading([40, 300, 900], 16, false)).toBe(0);
  });

  test('the last heading at or above the offset wins', () => {
    expect(activeHeading([-500, -20, 16, 400], 16, false)).toBe(2);
    expect(activeHeading([-500, -20, 17, 400], 16, false)).toBe(1);
  });

  test('scrolled to the bottom picks the last heading', () => {
    expect(activeHeading([-500, -20, 200, 400], 16, true)).toBe(3);
  });
});
