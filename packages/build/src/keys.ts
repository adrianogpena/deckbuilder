import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where an app's private signing key lives: `~/.kedalion-keys/<app id>.pem`, outside every repo. */
export const signingKeyPath = (appId: string, home = homedir()): string => join(home, '.kedalion-keys', `${appId}.pem`);

/** The public key the app embeds: base64 of the 32 raw Ed25519 bytes, committed next to app.ts. */
export const PUBLIC_KEY_FILE = 'update-key.pub';

export interface KeygenOptions {
  appId: string;
  appDir: string;
  home?: string;
  /** Replaces an existing private key; every installed exe then rejects new releases. */
  force?: boolean;
}

/** Creates the app's Ed25519 key pair; returns the paths written. */
export function keygen({ appId, appDir, home = homedir(), force = false }: KeygenOptions): { privateKey: string; publicKey: string } {
  const privatePath = signingKeyPath(appId, home);
  if (existsSync(privatePath) && !force) {
    throw new Error(`${privatePath} already exists; pass --force to replace it (installed exes then reject new releases).`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  mkdirSync(join(home, '.kedalion-keys'), { recursive: true, mode: 0o700 });
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32);
  const publicPath = join(appDir, PUBLIC_KEY_FILE);
  writeFileSync(publicPath, `${raw.toString('base64')}\n`);
  return { privateKey: privatePath, publicKey: publicPath };
}

/** The PEM private key: env `KEDALION_SIGNING_KEY` (CI), else the key file, else null. */
export function loadSigningKey(appId: string, home = homedir()): string | null {
  const env = process.env.KEDALION_SIGNING_KEY;
  if (env?.trim()) return env;
  const path = signingKeyPath(appId, home);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Base64 Ed25519 signature of `bytes`. */
export function signManifest(bytes: Uint8Array, privateKeyPem: string): string {
  return sign(null, bytes, createPrivateKey(privateKeyPem)).toString('base64');
}
