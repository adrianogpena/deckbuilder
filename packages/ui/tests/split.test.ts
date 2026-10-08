import { describe, expect, test } from 'bun:test';
import { clampSizes, dragDivider } from '../src/split.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('clampSizes', () => {
  test('keeps sizes that respect the minimums', () => {
    expect(clampSizes([0.3, 0.7], [100, 100], 1000)).toEqual([0.3, 0.7]);
  });

  test('raises a pane to its minimum and shrinks the others, sum stays 1', () => {
    const out = clampSizes([0.05, 0.45, 0.5], [200, 100, 100], 1000);
    expect(out[0]).toBeCloseTo(0.2);
    expect(out[1]).toBeCloseTo(0.8 * (0.45 / 0.95));
    expect(out[2]).toBeCloseTo(0.8 * (0.5 / 0.95));
    expect(sum(out)).toBeCloseTo(1);
  });

  test('a pane pushed below its minimum by the spreading is pinned too', () => {
    const out = clampSizes([0.02, 0.18, 0.8], [300, 150, 100], 1000);
    expect(out[0]).toBeCloseTo(0.3);
    expect(out[1]).toBeCloseTo(0.15);
    expect(out[2]).toBeCloseTo(0.55);
    expect(sum(out)).toBeCloseTo(1);
  });

  test('normalizes sizes that do not sum to 1', () => {
    expect(clampSizes([2, 2], [0, 0], 1000)).toEqual([0.5, 0.5]);
  });

  test('minimums above the total give sizes proportional to the minimums', () => {
    expect(clampSizes([0.5, 0.5], [300, 100], 200)).toEqual([0.75, 0.25]);
  });

  test('missing minimums default to 120 px', () => {
    const out = clampSizes([0.05, 0.95], [], 1000);
    expect(out[0]).toBeCloseTo(0.12);
  });
});

describe('dragDivider', () => {
  test('moves the two neighbours', () => {
    const out = dragDivider([0.5, 0.5], 0, 100, 1000, [100, 100]);
    expect(out[0]).toBeCloseTo(0.6);
    expect(out[1]).toBeCloseTo(0.4);
  });

  test('stops at a minimum', () => {
    const right = dragDivider([0.5, 0.5], 0, 900, 1000, [100, 200]);
    expect(right[0]).toBeCloseTo(0.8);
    expect(right[1]).toBeCloseTo(0.2);
    const left = dragDivider([0.5, 0.5], 0, -900, 1000, [100, 200]);
    expect(left[0]).toBeCloseTo(0.1);
    expect(left[1]).toBeCloseTo(0.9);
  });

  test('with three panes only the neighbours of the divider move', () => {
    const out = dragDivider([0.3, 0.3, 0.4], 1, 50, 1000, [100, 100, 100]);
    expect(out[0]).toBe(0.3);
    expect(out[1]).toBeCloseTo(0.35);
    expect(out[2]).toBeCloseTo(0.35);
  });

  test('an index without a following pane changes nothing', () => {
    const sizes = [0.5, 0.5];
    expect(dragDivider(sizes, 1, 50, 1000, [])).toBe(sizes);
  });
});
