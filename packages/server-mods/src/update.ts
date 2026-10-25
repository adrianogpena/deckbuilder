import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isCompiledExe, startDetached, updatePaths } from '@kedalion/platform';
import {
  AppError,
  isNewerVersion,
  MANIFEST,
  MANIFEST_SIG,
  parseManifest,
  platformLabel,
  type ReleaseFile,
  type ReleaseManifest,
  type Routes,
  type UpdateState,
  verifyManifest,
} from '@kedalion/server-core';

export const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
/** After a failed check (off VPN, share down): try again sooner than the regular interval. */
export const RETRY_MS = 30 * 60_000;
/** A UNC path off VPN can hang for the SMB timeout; give up before that. */
const READ_TIMEOUT_MS = 15_000;
/** `POST /api/update/apply` answers before the process quits. */
const QUIT_DELAY_MS = 300;

/** File operations the updater needs; faked in tests. */
export interface UpdateFs {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  copy(from: string, to: string): Promise<void>;
  sha256(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  /** Succeeds when the file is already gone. */
  remove(path: string): Promise<void>;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms).unref())]);

const nodeFs: UpdateFs = {
  readText: (path) => withTimeout(readFile(path, 'utf8'), READ_TIMEOUT_MS),
  readBytes: async (path) => new Uint8Array(await withTimeout(readFile(path), READ_TIMEOUT_MS)),
  copy: (from, to) => copyFile(from, to),
  sha256: (path) =>
    new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      createReadStream(path)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')));
    }),
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
};

/** A refusal or failure to show the user; `code` is its message id (`error.<code>`). */
export class UpdateError extends AppError {
  constructor(code: string, message: string, params?: Record<string, string | number>) {
    super('invalid', code, message, { params });
  }
}

/** The manifest couldn't be read (`unreachable`: off VPN, share down) or isn't a release. */
export class SourceError extends Error {
  constructor(
    readonly unreachable: boolean,
    message: string,
  ) {
    super(message);
  }
}

/** The release in a manifest's text; null when it isn't JSON or not a valid release. */
export function readManifest(text: string): ReleaseManifest | null {
  try {
    return parseManifest(JSON.parse(text));
  } catch {
    return null;
  }
}

/** What a source found, not yet trusted: the updater checks the signature, then parses. */
export interface SignedRelease {
  /** The exact bytes of latest.json. */
  bytes: Uint8Array;
  /** latest.json.sig; null when the source has none. */
  signature: string | null;
  /** Copies `file` of this release to `to`. */
  download(file: ReleaseFile, to: string): Promise<void>;
}

export interface Release {
  manifest: ReleaseManifest;
  download: SignedRelease['download'];
}

/** Where releases come from: a folder or GitHub releases. */
export interface UpdateSource {
  /** Identifies the source: once it changes, what the previous one offered no longer applies. */
  id: string;
  /** Throws SourceError. */
  latest(): Promise<SignedRelease>;
}

/**
 * The release, once its signature checks out against the app's public key. Throws
 * UpdateError('updateBadSignature') for a missing or wrong signature, SourceError when the signed
 * manifest isn't a valid release.
 */
export function verifiedRelease(signed: SignedRelease, publicKey: string): Release {
  if (signed.signature === null || !verifyManifest(signed.bytes, signed.signature, publicKey)) {
    throw new UpdateError('updateBadSignature', `${MANIFEST} isn't signed with this app's update key.`);
  }
  const manifest = readManifest(new TextDecoder().decode(signed.bytes));
  if (!manifest) throw new SourceError(false, `${MANIFEST} is not a valid release`);
  return { manifest, download: signed.download };
}

/**
 * Releases in a folder (often a UNC share) holding latest.json, as `kedalion release --to`
 * writes it; also looks in its `<subfolder>` (the app name), where `release --to <root>` puts them.
 */
export function folderSource(path: string, opts: { subfolder?: string; fs?: UpdateFs } = {}): UpdateSource {
  const fs = opts.fs ?? nodeFs;
  return {
    id: `folder:${path}`,
    async latest() {
      let unreachable = true;
      for (const dir of opts.subfolder ? [path, join(path, opts.subfolder)] : [path]) {
        let bytes: Uint8Array;
        try {
          bytes = await fs.readBytes(join(dir, MANIFEST));
        } catch {
          continue;
        }
        unreachable = false;
        // Picks the folder holding a release; the updater trusts it only once the signature checks out.
        if (!readManifest(new TextDecoder().decode(bytes))) continue;
        const signature = await fs.readText(join(dir, MANIFEST_SIG)).catch(() => null);
        return { bytes, signature, download: (file, to) => fs.copy(join(dir, file.file), to) };
      }
      throw new SourceError(unreachable, unreachable ? `Can't read ${MANIFEST} in ${path}` : `${MANIFEST} in ${path} is not a valid release`);
    },
  };
}

interface GithubAsset {
  name: string;
  url: string;
}

interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubAsset[];
}

/**
 * Releases of a GitHub repo: the newest published (not draft, not prerelease) one whose tag starts
 * with `tagPrefix` and that carries a latest.json asset, as the release workflow uploads it.
 */
export function githubSource(opts: { repo: string; tagPrefix: string; token?: string; fetch?: typeof fetch }): UpdateSource {
  const doFetch = opts.fetch ?? fetch;
  const headers = (accept: string, auth: boolean): Record<string, string> => ({
    Accept: accept,
    'User-Agent': 'kedalion',
    ...(auth && opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
  });

  /** Asset content: the API URL answers with a redirect to a storage host, which must not get the token. */
  const assetRequest = async (asset: GithubAsset, timeoutMs?: number): Promise<Response> => {
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
    let res = await doFetch(asset.url, { headers: headers('application/octet-stream', true), redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new SourceError(false, `GitHub redirected ${asset.name} without a location`);
      let next: URL;
      try {
        next = new URL(location, asset.url);
      } catch {
        throw new SourceError(false, `GitHub redirected ${asset.name} to an invalid location`);
      }
      if (next.protocol !== 'https:') throw new SourceError(false, `GitHub redirected ${asset.name} to a non-https location`);
      res = await doFetch(next.href, { headers: { 'User-Agent': 'kedalion' }, signal });
    }
    if (!res.ok) throw new SourceError(false, `GitHub answered ${res.status} for ${asset.name}`);
    return res;
  };

  const network = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SourceError) throw e;
      throw new SourceError(true, `Can't reach GitHub for ${what}: ${(e as Error).message}`);
    }
  };

  return {
    id: `github:${opts.repo}`,
    async latest() {
      const releases = await network('the release list', async () => {
        const res = await doFetch(`https://api.github.com/repos/${opts.repo}/releases?per_page=20`, {
          headers: headers('application/vnd.github+json', true),
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
        if (!res.ok) throw new SourceError(false, `GitHub answered ${res.status} for the releases of ${opts.repo}`);
        return (await res.json()) as GithubRelease[];
      });
      const release = releases.find((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(opts.tagPrefix));
      if (!release) throw new SourceError(false, `${opts.repo} has no published release tagged ${opts.tagPrefix}*`);
      const find = (name: string) => release.assets.find((a) => a.name === name);
      const manifestAsset = find(MANIFEST);
      if (!manifestAsset) throw new SourceError(false, `Release ${release.tag_name} has no ${MANIFEST}`);
      const bytes = await network(MANIFEST, async () => new Uint8Array(await (await assetRequest(manifestAsset, READ_TIMEOUT_MS)).arrayBuffer()));
      const sigAsset = find(MANIFEST_SIG);
      const signature = sigAsset ? await network(MANIFEST_SIG, async () => (await assetRequest(sigAsset, READ_TIMEOUT_MS)).text()) : null;
      return {
        bytes,
        signature,
        async download(file, to) {
          const asset = find(file.file);
          if (!asset) throw new Error(`Release ${release.tag_name} has no ${file.file}`);
          await Bun.write(to, await assetRequest(asset));
        },
      };
    },
  };
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface UpdaterOptions {
  version: string;
  /** The app's update public key (updatePublicKey); null: this build can't trust any release. */
  publicKey: string | null;
  /** Read at every check; null means not configured. */
  source(): UpdateSource | null | Promise<UpdateSource | null>;
  execPath?: string;
  /** False when running from source: checks work, apply refuses. */
  compiled?: boolean;
  /** Flags for the new exe, after `--after-update`; default: this process's flags. */
  relaunchArgs?: string[];
  /** Release file label to install; default: this machine (platformLabel). */
  label?: string;
  onChange?(state: UpdateState): void;
  fs?: UpdateFs;
  /** Starts the new exe detached from this process; rejects when it can't. */
  start?: (argv: string[]) => Promise<void>;
  clock?: Clock;
  log?: (msg: string) => void;
}

export interface Updater {
  /** First check, then every 6 h. */
  start(): void;
  /** Checks now; call it after the source setting changed. */
  check(): Promise<UpdateState>;
  /**
   * Swaps the running exe for the released one and starts it; the caller then quits this
   * process. Throws UpdateError with the current exe left in place.
   */
  apply(): Promise<{ version: string }>;
  state(): UpdateState;
  stop(): void;
}

export function createUpdater(opts: UpdaterOptions): Updater {
  const fs = opts.fs ?? nodeFs;
  const clock = opts.clock ?? systemClock;
  const execPath = opts.execPath ?? process.execPath;
  const compiled = opts.compiled ?? isCompiledExe(execPath);
  const label = opts.label ?? platformLabel();
  const log = opts.log ?? ((msg) => console.log(`update: ${msg}`));
  const empty = { current: opts.version, canApply: compiled, available: false, version: null, notes: null, checkedAt: null };
  let sourceId: string | null = null;
  let state: UpdateState = { ...empty, status: 'not-configured', nextAt: null, source: null };
  const withSource = (s: Omit<UpdateState, 'source'>): UpdateState => ({ ...s, source: sourceId });
  let timer: unknown = null;
  let inflight: Promise<UpdateState> | null = null;
  let queued: Promise<UpdateState> | null = null;
  let applying = false;

  const publish = (next: Omit<UpdateState, 'source'>) => {
    if (next.status !== state.status || next.message !== state.message) log(`check: ${next.status}${next.message ? ` (${next.message})` : ''}`);
    state = withSource(next);
    opts.onChange?.(state);
    return state;
  };

  const schedule = (ms: number | null) => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = ms === null ? null : clock.setTimeout(() => void check(), ms);
    return ms === null ? null : clock.now() + ms;
  };

  const run = async (): Promise<UpdateState> => {
    const source = await opts.source();
    if (source?.id !== sourceId) {
      // What the previous source offered no longer applies.
      sourceId = source?.id ?? null;
      state = { ...state, ...empty };
    }
    if (!source) return publish({ ...empty, status: 'not-configured', nextAt: schedule(null) });
    if (opts.publicKey === null) {
      return publish({ ...empty, canApply: false, status: 'not-configured', code: 'updateNoKey', message: 'No update key in this build', nextAt: schedule(null) });
    }
    try {
      const { manifest } = verifiedRelease(await source.latest(), opts.publicKey);
      const available = isNewerVersion(manifest.version, opts.version) && manifest.files[label] !== undefined;
      return publish({
        ...empty,
        status: 'ok',
        available,
        version: manifest.version,
        notes: manifest.notes,
        checkedAt: clock.now(),
        nextAt: schedule(CHECK_INTERVAL_MS),
      });
    } catch (e) {
      // A tampered manifest must not keep advertising an update.
      if (e instanceof UpdateError) return publish({ ...empty, status: 'error', code: e.code, message: e.message, nextAt: schedule(RETRY_MS) });
      // The last good result stays: a share that's briefly away shouldn't hide an update.
      const status = e instanceof SourceError && e.unreachable ? 'offline' : 'error';
      return publish({ ...state, status, code: undefined, message: (e as Error).message, nextAt: schedule(RETRY_MS) });
    }
  };

  // A check asked for during another (e.g. the source just changed) runs again after it.
  const check = (): Promise<UpdateState> => {
    if (inflight) {
      queued ??= inflight.then(() => {
        queued = null;
        return check();
      });
      return queued;
    }
    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const apply = async (): Promise<{ version: string }> => {
    if (!compiled) throw new UpdateError('updateFromSource', 'Running from source: only the built exe can update itself.');
    const source = await opts.source();
    if (!source) throw new UpdateError('updateNotConfigured', 'No update source is configured.');
    if (opts.publicKey === null) throw new UpdateError('updateNoKey', 'This build has no update key.');
    if (applying) throw new UpdateError('updateBusy', 'An update is already running.');
    applying = true;
    try {
      let release: Release;
      try {
        release = verifiedRelease(await source.latest(), opts.publicKey);
      } catch (e) {
        throw e instanceof UpdateError ? e : new UpdateError('updateUnreachable', (e as Error).message);
      }
      const { manifest } = release;
      if (!isNewerVersion(manifest.version, opts.version)) {
        throw new UpdateError('updateUpToDate', `Already up to date (v${opts.version}).`, { version: opts.version });
      }
      const file = manifest.files[label];
      if (!file) throw new UpdateError('updateNoBuild', `Release ${manifest.version} has no build for ${label}.`, { version: manifest.version, label });
      const { fresh, old } = updatePaths(execPath);
      let moved = false;
      let installed = false;
      try {
        await release.download(file, fresh);
        if ((await fs.sha256(fresh)) !== file.sha256) {
          throw new UpdateError('updateChecksum', 'The copied file does not match the release checksum.');
        }
        await fs.remove(old);
        // Windows allows renaming a running exe, not replacing it.
        await fs.rename(execPath, old);
        moved = true;
        await fs.rename(fresh, execPath);
        installed = true;
        const args = opts.relaunchArgs ?? process.argv.slice(2).filter((a) => a !== '--after-update');
        await (opts.start ?? startDetached)([execPath, '--after-update', ...args]);
      } catch (e) {
        await rollback({ fs, exe: execPath, fresh, old, moved, installed, log });
        throw e instanceof UpdateError ? e : new UpdateError('updateFailed', `Update failed: ${(e as Error).message}`, { message: (e as Error).message });
      }
      log(`updating ${opts.version} → ${manifest.version}`);
      return { version: manifest.version };
    } finally {
      applying = false;
    }
  };

  return {
    start: () => void check(),
    check,
    apply,
    state: () => state,
    stop: () => void schedule(null),
  };
}

/** Puts the original exe back under its name; every step is attempted and logged. */
async function rollback(s: { fs: UpdateFs; exe: string; fresh: string; old: string; moved: boolean; installed: boolean; log: (msg: string) => void }) {
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      s.log(`rollback: ${what} failed: ${(e as Error).message}`);
    }
  };
  if (s.installed) await attempt('move new exe aside', () => s.fs.rename(s.exe, s.fresh));
  if (s.moved) await attempt('restore exe', () => s.fs.rename(s.old, s.exe));
  await attempt('remove new exe', () => s.fs.remove(s.fresh));
}

/**
 * GET /api/update (state), POST /api/update/check (fresh state) and POST /api/update/apply, which
 * swaps in the released exe, answers `{ version }`, then calls `quit` (the shell's `ctx.quit`; the
 * new exe is already starting).
 */
export function updateRoutes(updater: Updater, quit: () => void): Routes {
  return {
    'GET /api/update': () => updater.state(),
    'POST /api/update/check': () => updater.check(),
    'POST /api/update/apply': async () => {
      const result = await updater.apply();
      setTimeout(quit, QUIT_DELAY_MS);
      return result;
    },
  };
}
