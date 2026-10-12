import { expect, test } from 'bun:test';
import { freeName } from './os-drop';

test('freeName numbers a taken name like the server copy route', () => {
  expect(freeName('a.txt', false, new Set())).toBe('a.txt');
  expect(freeName('a.txt', false, new Set(['a.txt']))).toBe('a copy.txt');
  expect(freeName('a.txt', false, new Set(['a.txt', 'a copy.txt']))).toBe('a copy 2.txt');
  expect(freeName('dir.v2', true, new Set(['dir.v2']))).toBe('dir.v2 copy');
  expect(freeName('.env', false, new Set(['.env']))).toBe('.env copy');
});

test('freeName compares with the fold function', () => {
  expect(freeName('A.txt', false, new Set(['a.txt']), (n) => n.toLowerCase())).toBe('A copy.txt');
});
