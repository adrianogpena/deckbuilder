import { expect, test } from 'bun:test';
import { fileSlug } from './build.ts';

test('fileSlug makes names safe for release file names', () => {
  expect(fileSlug('My Tool')).toBe('My-Tool');
  expect(fileSlug('a  b -- c')).toBe('a-b-c');
  expect(fileSlug('Configuração')).toBe('Configurao');
});

test('fileSlug falls back when nothing usable is left', () => {
  expect(fileSlug('', 'tool')).toBe('tool');
  expect(fileSlug('日本語', 'tool')).toBe('tool');
  expect(fileSlug('.hidden', 'tool')).toBe('tool');
});
