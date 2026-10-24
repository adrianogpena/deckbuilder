import { expect, test } from 'bun:test';
import { clampSideWidth, defaultSideWidth, parseSideWidth, SIDE_W, sideWidthKey } from '../src/view-side.ts';

test('clampSideWidth keeps 560..980', () => {
  expect(clampSideWidth(100)).toBe(SIDE_W.min);
  expect(clampSideWidth(5000)).toBe(SIDE_W.max);
  expect(clampSideWidth(700.4)).toBe(700);
});

test('defaultSideWidth is 64% of the viewport, clamped', () => {
  expect(defaultSideWidth(1250)).toBe(800);
  expect(defaultSideWidth(600)).toBe(560);
  expect(defaultSideWidth(3000)).toBe(980);
});

test('parseSideWidth', () => {
  expect(parseSideWidth('700')).toBe(700);
  expect(parseSideWidth('100')).toBe(560);
  expect(parseSideWidth('abc')).toBeNull();
  expect(parseSideWidth('')).toBeNull();
  expect(parseSideWidth(null)).toBeNull();
});

test('sideWidthKey', () => {
  expect(sideWidthKey('dashboard')).toBe('deckbuilder.viewSide.dashboard.w');
});
