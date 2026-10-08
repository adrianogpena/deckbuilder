import { afterEach, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { join } from 'node:path';
import type { UpdateState } from '@deckbuilder/server-core';
import { CHECK_INTERVAL_MS, type Clock, createUpdater, folderSource, githubSource, RETRY_MS, type UpdateFs, type Updater, type UpdaterOptions, verifiedRelease } from './update.ts';

const SHARE = '\\\\server\\share\\Gallery';
const EXE_DIR = 'C:\\apps';
const EXE = join(EXE_DIR, 'gallery.exe');
const NEW_EXE = join(EXE_DIR, 'gallery.new.exe');
const OLD_EXE = join(EXE_DIR, 'gallery.old.exe');
const sha = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');

const manifest = (version: string, body = `exe ${version}`) =>
  JSON.stringify({
    version,
    notes: '- Faster things',
    date: '2026-10-07T10:00:00.000Z',
    files: { 'win-x64': { file: `Gallery-${version}-win-x64.exe`, sha256: sha(body) } },
  });

const keys = generateKeyPairSync('ed25519');
const PUBLIC_KEY = (keys.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('base64');
const signText = (text: string) => sign(null, Buffer.from(text), keys.privateKey).toString('base64');
/** latest.json and its signature in `dir`. */
const signed = (dir: string, text: string) => ({ [join(dir, 'latest.json')]: text, [join(dir, 'latest.json.sig')]: signText(text) });

type Fail = (op: string, a: string, b?: string) => boolean;

function fakeFs(files: Record<string, string>, fail: Fail = () => false) {
  const map = new Map(Object.entries(files));
  const ops: string[] = [];
  const get = (p: string) => {
    const v = map.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  };
  const fs: UpdateFs = {
    readText: async (p) => {
      if (fail('read', p)) throw new Error('unreachable');
      return get(p);
    },
    readBytes: async (p) => {
      if (fail('read', p)) throw new Error('unreachable');
      return new TextEncoder().encode(get(p));
    },
    copy: async (a, b) => {
      ops.push(`copy ${a} ${b}`);
      if (fail('copy', a, b)) throw new Error('copy failed');
      map.set(b, get(a));
    },
    sha256: async (p) => sha(get(p)),
    rename: async (a, b) => {
      ops.push(`rename ${a} ${b}`);
      if (fail('rename', a, b)) throw new Error('rename failed');
      map.set(b, get(a));
      map.delete(a);
    },
    remove: async (p) => {
      if (fail('remove', p)) throw new Error('EBUSY');
      map.delete(p);
    },
  };
  return { fs, map, ops };
}

function fakeClock() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const clock: Clock = {
    now: () => 1_000_000,
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimeout: (h) => timers.delete(h as number),
  };
  return { clock, timers };
}

const updaters: Updater[] = [];
afterEach(() => {
  for (const u of updaters.splice(0)) u.stop();
});

function setup(
  opts: {
    files?: Record<string, string>;
    folder?: string | null;
    version?: string;
    compiled?: boolean;
    fail?: Fail;
    start?: UpdaterOptions['start'];
    publicKey?: string | null;
  } = {},
) {
  const box = { folder: opts.folder === undefined ? SHARE : opts.folder };
  const { fs, map, ops } = fakeFs(
    opts.files ?? {
      [EXE]: 'exe 0.1.0',
      ...signed(SHARE, manifest('0.2.0')),
      [join(SHARE, 'Gallery-0.2.0-win-x64.exe')]: 'exe 0.2.0',
    },
    opts.fail,
  );
  const { clock, timers } = fakeClock();
  const published: UpdateState[] = [];
  const started: string[][] = [];
  const updater = createUpdater({
    version: opts.version ?? '0.1.0',
    publicKey: opts.publicKey === undefined ? PUBLIC_KEY : opts.publicKey,
    source: () => (box.folder ? folderSource(box.folder, { subfolder: 'Gallery', fs }) : null),
    execPath: EXE,
    compiled: opts.compiled ?? true,
    label: 'win-x64',
    relaunchArgs: [],
    onChange: (s) => published.push(s),
    fs,
    clock,
    log: () => {},
    start:
      opts.start ??
      (async (argv) => {
        started.push(argv);
      }),
  });
  updaters.push(updater);
  return { updater, box, map, ops, timers, published, started };
}

test('a newer release is reported with its notes, and the next check is in 6 h', async () => {
  const { updater, timers } = setup();
  const state = await updater.check();
  expect(state).toMatchObject({ status: 'ok', current: '0.1.0', available: true, version: '0.2.0', notes: '- Faster things', canApply: true });
  expect([...timers.values()].map((t) => t.ms)).toEqual([CHECK_INTERVAL_MS]);
});

test('the same or an older release is not an update', async () => {
  expect((await setup({ version: '0.2.0' }).updater.check()).available).toBe(false);
  expect((await setup({ version: '0.10.0' }).updater.check()).available).toBe(false);
});

test('a release without a build for this platform is not an update', async () => {
  const files = signed(SHARE, manifest('0.2.0').replace('win-x64"', 'linux-x64"'));
  expect((await setup({ files }).updater.check()).available).toBe(false);
});

test('latest.json is also found in the app subfolder release --to writes', async () => {
  const root = '\\\\server\\share';
  const { updater } = setup({ folder: root, files: signed(join(root, 'Gallery'), manifest('0.2.0')) });
  expect((await updater.check()).version).toBe('0.2.0');
});

test('an unreachable share is silent: offline, last data kept, retried in 30 min', async () => {
  let down = false;
  const { updater, timers } = setup({ fail: (op) => op === 'read' && down });
  await updater.check();
  down = true;
  const state = await updater.check();
  expect(state.status).toBe('offline');
  expect(state.available).toBe(true);
  expect([...timers.values()].map((t) => t.ms)).toEqual([RETRY_MS]);
});

test('a broken latest.json is an error, not offline', async () => {
  const { updater } = setup({ files: signed(SHARE, '{"version":"x"}') });
  expect((await updater.check()).status).toBe('error');
});

test('an unsigned or tampered latest.json is a signature error that drops the offered update', async () => {
  const unsigned = setup({ files: { [join(SHARE, 'latest.json')]: manifest('0.2.0') } });
  expect(await unsigned.updater.check()).toMatchObject({ status: 'error', code: 'updateBadSignature', available: false });

  const tampered = setup();
  expect((await tampered.updater.check()).available).toBe(true);
  tampered.map.set(join(SHARE, 'latest.json'), manifest('0.2.0').replace('Faster', 'Evil'));
  expect(await tampered.updater.check()).toMatchObject({ status: 'error', code: 'updateBadSignature', available: false, version: null });
});

test('a signature by another key is refused, and apply refuses it before copying', async () => {
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const { updater, ops } = setup({ publicKey: other });
  expect((await updater.check()).code).toBe('updateBadSignature');
  await expect(updater.apply()).rejects.toMatchObject({ code: 'updateBadSignature' });
  expect(ops).toEqual([]);
});

test('a build without an update key is not configured and never applies', async () => {
  const { updater, ops, timers } = setup({ publicKey: null });
  expect(await updater.check()).toMatchObject({ status: 'not-configured', code: 'updateNoKey', canApply: false, source: `folder:${SHARE}` });
  expect(timers.size).toBe(0);
  await expect(updater.apply()).rejects.toMatchObject({ code: 'updateNoKey' });
  expect(ops).toEqual([]);
});

test('without a source the updater is not configured and nothing is scheduled', async () => {
  const { updater, timers } = setup({ folder: null });
  expect((await updater.check()).status).toBe('not-configured');
  expect(timers.size).toBe(0);
});

test('a changed source drops what the previous one offered', async () => {
  const { updater, box } = setup();
  await updater.check();
  box.folder = '\\\\other\\share';
  const state = await updater.check();
  expect(state).toMatchObject({ status: 'offline', available: false, version: null });
});

test('apply copies, verifies, swaps the exe and starts it with --after-update', async () => {
  const { updater, map, ops, started } = setup();
  expect(await updater.apply()).toEqual({ version: '0.2.0' });
  expect(ops).toEqual([`copy ${join(SHARE, 'Gallery-0.2.0-win-x64.exe')} ${NEW_EXE}`, `rename ${EXE} ${OLD_EXE}`, `rename ${NEW_EXE} ${EXE}`]);
  expect(map.get(EXE)).toBe('exe 0.2.0');
  expect(map.get(OLD_EXE)).toBe('exe 0.1.0');
  expect(map.has(NEW_EXE)).toBe(false);
  expect(started).toEqual([[EXE, '--after-update']]);
});

test('a checksum mismatch aborts before the swap and removes the copy', async () => {
  const { updater, map, started } = setup({
    files: {
      [EXE]: 'exe 0.1.0',
      ...signed(SHARE, manifest('0.2.0')),
      [join(SHARE, 'Gallery-0.2.0-win-x64.exe')]: 'truncated',
    },
  });
  await expect(updater.apply()).rejects.toThrow('checksum');
  expect(map.get(EXE)).toBe('exe 0.1.0');
  expect(map.has(NEW_EXE)).toBe(false);
  expect(map.has(OLD_EXE)).toBe(false);
  expect(started).toEqual([]);
});

test('a failure after the first rename renames the exe back', async () => {
  const { updater, map, started } = setup({ fail: (op, a) => op === 'rename' && a === NEW_EXE });
  await expect(updater.apply()).rejects.toThrow('Update failed');
  expect(map.get(EXE)).toBe('exe 0.1.0');
  expect(map.has(OLD_EXE)).toBe(false);
  expect(map.has(NEW_EXE)).toBe(false);
  expect(started).toEqual([]);
});

test('a new exe that cannot start is swapped back out', async () => {
  const { updater, map } = setup({
    start: async () => {
      throw new Error('ENOENT');
    },
  });
  await expect(updater.apply()).rejects.toThrow('Update failed');
  expect(map.get(EXE)).toBe('exe 0.1.0');
  expect(map.has(OLD_EXE)).toBe(false);
  expect(map.has(NEW_EXE)).toBe(false);
});

test('from source the check works but apply refuses', async () => {
  const { updater, ops } = setup({ compiled: false });
  expect(await updater.check()).toMatchObject({ available: true, canApply: false });
  await expect(updater.apply()).rejects.toThrow('Running from source');
  expect(ops).toEqual([]);
});

test('apply refuses when already up to date', async () => {
  const { updater, ops } = setup({ version: '0.2.0' });
  await expect(updater.apply()).rejects.toThrow('Already up to date');
  expect(ops).toEqual([]);
});

const API = 'https://api.github.com/repos/o/r/releases?per_page=20';
const asset = (name: string) => ({ name, url: `https://api.github.com/assets/${name}` });
const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: [asset('latest.json'), asset('latest.json.sig'), asset(`Gallery-${tag.split('-v')[1]}-win-x64.exe`)],
  ...extra,
});

const ghBodies = (text: string, extra: Record<string, string> = {}) => ({ 'latest.json': text, 'latest.json.sig': signText(text), ...extra });

function fakeGithub(releases: unknown[], bodies: Record<string, string> = {}) {
  const calls: { url: string; headers: Record<string, string>; redirect?: string }[] = [];
  let offline = false;
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) }, redirect: init.redirect });
    if (offline) throw new TypeError('fetch failed');
    if (url === API) return Response.json(releases);
    if (url.startsWith('https://api.github.com/assets/')) {
      return new Response(null, { status: 302, headers: { location: `https://storage.example/${url.split('/').pop()}` } });
    }
    const body = bodies[url.split('/').pop()!];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body);
  }) as unknown as typeof fetch;
  return { fn, calls, down: () => (offline = true) };
}

test('githubSource picks the newest published release of its own tag prefix', async () => {
  const gh = fakeGithub(
    [rel('gallery-v0.4.0', { draft: true }), rel('other-v9.0.0'), rel('gallery-v0.3.0', { prerelease: true }), rel('gallery-v0.2.0'), rel('gallery-v0.1.0')],
    ghBodies(manifest('0.2.0')),
  );
  const source = githubSource({ repo: 'o/r', tagPrefix: 'gallery-v', fetch: gh.fn });
  expect(source.id).toBe('github:o/r');
  expect(verifiedRelease(await source.latest(), PUBLIC_KEY).manifest.version).toBe('0.2.0');
});

test('githubSource sends the token to the API but not to the storage host', async () => {
  const gh = fakeGithub([rel('gallery-v0.2.0')], ghBodies(manifest('0.2.0')));
  await githubSource({ repo: 'o/r', tagPrefix: 'gallery-v', token: 'secret', fetch: gh.fn }).latest();
  const [list, asset1, storage] = gh.calls;
  expect(list!.headers.Authorization).toBe('Bearer secret');
  expect(asset1).toMatchObject({ redirect: 'manual', headers: { Accept: 'application/octet-stream', Authorization: 'Bearer secret' } });
  expect(storage!.url).toStartWith('https://storage.example/');
  expect(storage!.headers.Authorization).toBeUndefined();
});

test('githubSource offline is an offline state, a missing latest.json an error', async () => {
  const gh = fakeGithub([rel('gallery-v0.2.0')], ghBodies(manifest('0.2.0')));
  const updater = createUpdater({
    version: '0.1.0',
    publicKey: PUBLIC_KEY,
    source: () => githubSource({ repo: 'o/r', tagPrefix: 'gallery-v', fetch: gh.fn }),
    compiled: true,
    label: 'win-x64',
    clock: fakeClock().clock,
    log: () => {},
  });
  updaters.push(updater);
  expect(await updater.check()).toMatchObject({ status: 'ok', available: true, source: 'github:o/r' });
  gh.down();
  expect((await updater.check()).status).toBe('offline');

  const noManifest = fakeGithub([rel('gallery-v0.2.0', { assets: [] })]);
  const err = await githubSource({ repo: 'o/r', tagPrefix: 'gallery-v', fetch: noManifest.fn })
    .latest()
    .catch((e) => e);
  expect(err).toMatchObject({ unreachable: false });
  expect(err.message).toContain('latest.json');
});

test('githubSource without latest.json.sig is a signature error', async () => {
  const gh = fakeGithub([rel('gallery-v0.2.0', { assets: [asset('latest.json')] })], { 'latest.json': manifest('0.2.0') });
  const signedRelease = await githubSource({ repo: 'o/r', tagPrefix: 'gallery-v', fetch: gh.fn }).latest();
  expect(signedRelease.signature).toBeNull();
  expect(() => verifiedRelease(signedRelease, PUBLIC_KEY)).toThrow(expect.objectContaining({ code: 'updateBadSignature' }));
});

test('githubSource download writes the asset bytes', async () => {
  const gh = fakeGithub([rel('gallery-v0.2.0')], ghBodies(manifest('0.2.0'), { 'Gallery-0.2.0-win-x64.exe': 'exe 0.2.0' }));
  const release = verifiedRelease(await githubSource({ repo: 'o/r', tagPrefix: 'gallery-v', fetch: gh.fn }).latest(), PUBLIC_KEY);
  const to = join(process.env.TEMP ?? '/tmp', `gh-download-${process.pid}.bin`);
  await release.download(release.manifest.files['win-x64']!, to);
  expect(await Bun.file(to).text()).toBe('exe 0.2.0');
  await Bun.file(to).delete();
});
