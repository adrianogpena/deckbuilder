import { expect, test } from 'bun:test';
import { fileSlug, parseTargets } from './build.ts';

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

test('parseTargets takes a list, all, or this machine', () => {
  expect(parseTargets('windows-x64, linux-x64')).toEqual(['windows-x64', 'linux-x64']);
  expect(parseTargets('all')).toEqual(['windows-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']);
  expect(parseTargets(undefined)).toHaveLength(1);
  expect(() => parseTargets('windows-x64,amiga')).toThrow('unknown target amiga');
});
