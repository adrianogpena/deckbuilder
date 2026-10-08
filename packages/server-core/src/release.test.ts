import { expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { bumpVersion, isNewerVersion, parseManifest, platformLabel, verifyManifest } from './release.ts';

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

const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, raw: (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('base64') };
};

test('verifyManifest accepts the signed bytes only, with the signing key only', () => {
  const { privateKey, raw } = keyPair();
  const bytes = new TextEncoder().encode(JSON.stringify(valid));
  const sig = sign(null, bytes, privateKey).toString('base64');
  expect(verifyManifest(bytes, sig, raw)).toBe(true);
  const changed = bytes.slice();
  changed[10] = changed[10]! ^ 1;
  expect(verifyManifest(changed, sig, raw)).toBe(false);
  expect(verifyManifest(bytes, sig, keyPair().raw)).toBe(false);
  expect(verifyManifest(bytes, 'not base64!', raw)).toBe(false);
  expect(verifyManifest(bytes, sig, 'short')).toBe(false);
});
