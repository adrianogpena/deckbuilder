import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { bumpVersion, MANIFEST, MANIFEST_SIG, type ReleaseManifest, type VersionBump } from '@deckbuilderkit/server-core';
import { type AppDir, workspaceRoot } from './app.ts';
import { buildExe, buildWeb, releasePrefix, type Target } from './build.ts';
import { loadSigningKey, signManifest } from './keys.ts';

export const BUMPS: VersionBump[] = ['patch', 'minor', 'major'];

export interface ReleaseOptions {
  /** Release folder root; files go to `<to>/<app name>/`, where the updater's folderSource looks. */
  to: string;
  bump: VersionBump;
  targets: Target[];
  /** Publishes the same files, then puts package.json back and leaves git alone. */
  dryRun: boolean;
  /** Runs typecheck and tests first. */
  checks: boolean;
  /** Publishes without latest.json.sig; builds with an update key then refuse the release. */
  unsigned: boolean;
}

/** The app's private signing key; throws without one, unless `unsigned` (then null and a warning). */
function signingKey(app: AppDir, unsigned: boolean): string | null {
  if (unsigned) {
    console.warn(`warning: --unsigned: no ${MANIFEST_SIG}; builds with an update key refuse this release`);
    return null;
  }
  const key = loadSigningKey(app.id);
  if (!key) throw new Error('No signing key: run `deckbuilder keygen` (or pass --unsigned).');
  return key;
}

interface ManifestFiles {
  /** The exact bytes of latest.json. */
  bytes: Uint8Array;
  /** Their signature, or null when unsigned. */
  sig: string | null;
}

function manifestFiles(manifest: ReleaseManifest, key: string | null): ManifestFiles {
  const bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return { bytes, sig: key ? `${signManifest(bytes, key)}\n` : null };
}

/** Writes latest.json.sig, or removes a stale one when unsigned. */
function writeSig(dir: string, sig: string | null): void {
  if (sig) writeFileSync(join(dir, MANIFEST_SIG), sig);
  else rmSync(join(dir, MANIFEST_SIG), { force: true });
}

/** Tags of an app's releases start with its folder name: `gallery-v0.3.0`. */
const tagPrefix = (app: AppDir): string => `${basename(app.dir)}-v`;

/** Runs git in the workspace root; returns trimmed stdout, throws with stderr on failure. */
const rootGit =
  (root: string) =>
  (args: string[]): string => {
    const r = Bun.spawnSync(['git', ...args], { cwd: root });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString().trim()}`);
    return r.stdout.toString().trim();
  };

const sha256 = async (path: string): Promise<string> => new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex');

/**
 * Bumps the version, builds the exes and publishes them with latest.json, then commits the bump
 * and tags `<app folder>-v<version>` locally. Never pushes.
 */
export async function release(app: AppDir, opts: ReleaseOptions): Promise<void> {
  const root = await workspaceRoot(app.dir);
  const git = rootGit(root);
  const sh = (cmd: string[]) => {
    console.log(`> ${cmd.join(' ')}`);
    if (Bun.spawnSync(cmd, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] }).exitCode !== 0) throw new Error(`failed: ${cmd.join(' ')}`);
  };

  if (!opts.dryRun && git(['status', '--porcelain']) !== '') {
    throw new Error('Commit or stash your changes first: the release is built from HEAD and tagged.');
  }
  const version = bumpVersion(app.version, opts.bump);
  const prefix = tagPrefix(app);
  const tag = `${prefix}${version}`;
  if (git(['tag', '--list', tag]) !== '') throw new Error(`Tag ${tag} already exists.`);
  const key = signingKey(app, opts.unsigned);
  const notes = releaseNotes(git, prefix, version);

  const pkgPath = join(app.dir, 'package.json');
  const pkgText = readFileSync(pkgPath, 'utf8');
  // The exe reads its version from package.json, so even a dry run builds with the bump.
  writeFileSync(pkgPath, pkgText.replace(`"version": "${app.version}"`, `"version": "${version}"`));
  try {
    if (opts.checks) {
      sh(['bun', 'run', 'typecheck']);
      sh(['bun', 'test']);
    }
    const next = { ...app, version };
    buildWeb(next);
    const exes: string[] = [];
    for (const target of opts.targets) exes.push(await buildExe(next, target));
    const manifest = await buildManifest(next, exes, notes);
    const dest = join(opts.to, app.name);
    await publish(exes, dest, manifest, manifestFiles(manifest, key));
    console.log(`published ${tag} to ${dest}`);
  } catch (e) {
    writeFileSync(pkgPath, pkgText);
    throw e;
  }

  if (opts.dryRun) {
    writeFileSync(pkgPath, pkgText);
    console.log(`dry run: package.json stays ${app.version}; no commit, no tag ${tag}`);
  } else {
    git(['commit', '-m', `Release ${tag}`, '--', pkgPath]);
    git(['tag', tag]);
    console.log(`committed and tagged ${tag}; push it yourself when ready`);
  }
}

/** The manifest for built exes named `<name>-<version>-<label>[.exe]`: label and sha256 per file. */
export async function buildManifest(app: AppDir, exes: string[], notes: string): Promise<ReleaseManifest> {
  const manifest: ReleaseManifest = { version: app.version, notes, date: new Date().toISOString(), files: {} };
  const prefix = releasePrefix(app);
  for (const exe of exes) {
    const file = basename(exe);
    if (!file.startsWith(prefix)) throw new Error(`${file} does not start with ${prefix}`);
    manifest.files[file.slice(prefix.length).replace(/\.exe$/, '')] = { file, sha256: await sha256(exe) };
  }
  return manifest;
}

/**
 * `deckbuilder manifest`: writes release/latest.json for the exes of the current version, with
 * notes since the previous release tag (what the release workflow uploads next to the exes).
 */
export async function writeManifest(app: AppDir, unsigned: boolean): Promise<void> {
  const key = signingKey(app, unsigned);
  const dir = join(app.dir, 'release');
  const prefix = releasePrefix(app);
  const exes = readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .map((f) => join(dir, f));
  if (exes.length === 0) throw new Error(`No ${prefix}* files in ${dir}; run build first.`);
  const git = rootGit(await workspaceRoot(app.dir));
  const manifest = await buildManifest(app, exes, releaseNotes(git, tagPrefix(app), app.version));
  const { bytes, sig } = manifestFiles(manifest, key);
  writeSig(dir, sig);
  writeFileSync(join(dir, MANIFEST), bytes);
  console.log(`wrote ${join(dir, MANIFEST)}${sig ? ` and ${MANIFEST_SIG}` : ''} (${Object.keys(manifest.files).join(', ')})`);
}

/** Commit summaries since the app's last release tag, one `- ` line each. */
export function releaseNotes(git: (args: string[]) => string, prefix: string, version: string): string {
  let since: string;
  try {
    since = git(['describe', '--tags', '--abbrev=0', '--match', `${prefix}*`, '--exclude', `${prefix}${version}`]);
  } catch {
    return '- First release';
  }
  const lines = git(['log', '--format=%s', `${since}..HEAD`])
    .split('\n')
    .filter((s) => s && !s.startsWith('Release '));
  return lines.length > 0 ? lines.map((s) => `- ${s}`).join('\n') : '- Maintenance release';
}

/**
 * Copies the exes, then writes latest.json last and atomically, after every copy is verified. Its
 * signature goes in first, so a reader never sees a new manifest without it.
 */
async function publish(exes: string[], dest: string, manifest: ReleaseManifest, { bytes, sig }: ManifestFiles): Promise<void> {
  mkdirSync(dest, { recursive: true });
  for (const exe of exes) {
    const entry = Object.values(manifest.files).find((f) => f.file === basename(exe))!;
    const target = join(dest, entry.file);
    copyFileSync(exe, target);
    if ((await sha256(target)) !== entry.sha256) throw new Error(`${target} does not match the built exe after copying`);
  }
  writeSig(dest, sig);
  const tmp = join(dest, `${MANIFEST}.tmp`);
  writeFileSync(tmp, bytes);
  renameSync(tmp, join(dest, MANIFEST));
}
