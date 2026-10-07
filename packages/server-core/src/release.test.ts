import { expect, test } from 'bun:test';
import { bumpVersion, isNewerVersion, parseManifest, platformLabel } from './release.ts';

const SHA = 'a'.repeat(64);
const valid = { version: '1.2.3', notes: '- x', date: '2026-10-07', files: { 'win-x64': { file: 'App-1.2.3-win-x64.exe', sha256: SHA } } };

test('parseManifest accepts a release and rejects paths, bad versions and bad hashes', () => {
  expect(parseManifest(valid)).toEqual(valid);
  expect(parseManifest({ ...valid, version: 'dev' })).toBeNull();
  expect(parseManifest({ ...valid, files: { 'win-x64': { file: '..\\evil.exe', sha256: SHA } } })).toBeNull();
  expect(parseManifest({ ...valid, files: { 'win-x64': { file: '../evil', sha256: SHA } } })).toBeNull();
  expect(parseManifest({ ...valid, files: { 'win-x64': { file: 'a.exe', sha256: 'nope' } } })).toBeNull();
  expect(parseManifest(null)).toBeNull();
});

test('versions compare numerically and any release beats dev', () => {
  expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
  expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
  expect(isNewerVersion('0.1.0', 'dev')).toBe(true);
  expect(isNewerVersion('dev', '0.1.0')).toBe(false);
  expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
});

test('platform labels match the release file names', () => {
  expect(platformLabel('win32', 'x64')).toBe('win-x64');
  expect(platformLabel('windows', 'x64')).toBe('win-x64');
  expect(platformLabel('darwin', 'arm64')).toBe('mac-arm64');
  expect(platformLabel('linux', 'arm64')).toBe('linux-arm64');
});
