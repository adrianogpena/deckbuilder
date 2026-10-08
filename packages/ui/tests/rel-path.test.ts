import { expect, test } from 'bun:test';
import { relPath } from '../src/rel-path.ts';

test('join skips the empty root', () => {
  expect(relPath.join('', 'a')).toBe('a');
  expect(relPath.join('a/b', 'c')).toBe('a/b/c');
});

test('dirname and basename', () => {
  expect(relPath.dirname('a/b/c.txt')).toBe('a/b');
  expect(relPath.dirname('c.txt')).toBe('');
  expect(relPath.dirname('')).toBe('');
  expect(relPath.basename('a/b/c.txt')).toBe('c.txt');
  expect(relPath.basename('c.txt')).toBe('c.txt');
  expect(relPath.basename('')).toBe('');
});

test('isUnder matches whole segments and the root', () => {
  expect(relPath.isUnder('a', 'a')).toBe(true);
  expect(relPath.isUnder('a/b', 'a')).toBe(true);
  expect(relPath.isUnder('ab', 'a')).toBe(false);
  expect(relPath.isUnder('a', 'a/b')).toBe(false);
  expect(relPath.isUnder('a/b', '')).toBe(true);
  expect(relPath.isUnder('', '')).toBe(true);
});

test('moved rewrites the path itself and children only', () => {
  expect(relPath.moved('a', 'a', 'x/y')).toBe('x/y');
  expect(relPath.moved('a/b/c', 'a', 'x')).toBe('x/b/c');
  expect(relPath.moved('ab/c', 'a', 'x')).toBe('ab/c');
  expect(relPath.moved('z', 'a', 'x')).toBe('z');
});
