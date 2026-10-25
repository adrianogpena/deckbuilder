import { expect, test } from 'bun:test';
import { platformLabel } from './release.ts';

test('platform labels match the release file names', () => {
  expect(platformLabel('win32', 'x64')).toBe('win-x64');
  expect(platformLabel('windows', 'x64')).toBe('win-x64');
  expect(platformLabel('darwin', 'arm64')).toBe('mac-arm64');
  expect(platformLabel('linux', 'arm64')).toBe('linux-arm64');
});
