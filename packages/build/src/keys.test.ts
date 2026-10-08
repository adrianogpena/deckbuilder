import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keygen, loadSigningKey, PUBLIC_KEY_FILE, signingKeyPath, signManifest } from './keys.ts';

let home: string;
let appDir: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'keys-home-'));
  appDir = mkdtempSync(join(tmpdir(), 'keys-app-'));
  delete process.env.DECKBUILDER_SIGNING_KEY;
});

afterEach(() => {
  delete process.env.DECKBUILDER_SIGNING_KEY;
  rmSync(home, { recursive: true, force: true });
  rmSync(appDir, { recursive: true, force: true });
});

test('keygen writes the private key under home and the raw public key in the app folder', () => {
  const paths = keygen({ appId: 'demo', appDir, home });
  expect(paths.privateKey).toBe(signingKeyPath('demo', home));
  expect(readFileSync(paths.privateKey, 'utf8')).toStartWith('-----BEGIN PRIVATE KEY-----');
  expect(paths.publicKey).toBe(join(appDir, PUBLIC_KEY_FILE));
  expect(Buffer.from(readFileSync(paths.publicKey, 'utf8').trim(), 'base64')).toHaveLength(32);
});

test('signManifest signatures verify with the public key', () => {
  keygen({ appId: 'demo', appDir, home });
  const pem = loadSigningKey('demo', home)!;
  const bytes = new TextEncoder().encode('{"version":"1.0.0"}\n');
  const sig = Buffer.from(signManifest(bytes, pem), 'base64');
  const raw = Buffer.from(readFileSync(join(appDir, PUBLIC_KEY_FILE), 'utf8').trim(), 'base64');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  expect(verify(null, bytes, key, sig)).toBe(true);
  expect(verify(null, new TextEncoder().encode('{"version":"1.0.1"}\n'), key, sig)).toBe(false);
});

test('keygen refuses to overwrite without force', () => {
  keygen({ appId: 'demo', appDir, home });
  const before = readFileSync(signingKeyPath('demo', home), 'utf8');
  expect(() => keygen({ appId: 'demo', appDir, home })).toThrow('--force');
  expect(readFileSync(signingKeyPath('demo', home), 'utf8')).toBe(before);
  keygen({ appId: 'demo', appDir, home, force: true });
  expect(readFileSync(signingKeyPath('demo', home), 'utf8')).not.toBe(before);
});

test('loadSigningKey prefers the env var and is null without a key', () => {
  expect(loadSigningKey('demo', home)).toBeNull();
  process.env.DECKBUILDER_SIGNING_KEY = 'from-env';
  expect(loadSigningKey('demo', home)).toBe('from-env');
  expect(existsSync(signingKeyPath('demo', home))).toBe(false);
});
