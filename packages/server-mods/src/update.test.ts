import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { UpdateState } from '@deckbase/server-core';
import { CHECK_INTERVAL_MS, type Clock, createUpdater, folderSource, RETRY_MS, type UpdateFs, type Updater, type UpdaterOptions } from './update.ts';

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
  } = {},
) {
  const box = { folder: opts.folder === undefined ? SHARE : opts.folder };
  const { fs, map, ops } = fakeFs(
    opts.files ?? {
      [EXE]: 'exe 0.1.0',
      [join(SHARE, 'latest.json')]: manifest('0.2.0'),
      [join(SHARE, 'Gallery-0.2.0-win-x64.exe')]: 'exe 0.2.0',
    },
    opts.fail,
  );
  const { clock, timers } = fakeClock();
  const published: UpdateState[] = [];
  const started: string[][] = [];
  const updater = createUpdater({
    version: opts.version ?? '0.1.0',
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
  const files = { [join(SHARE, 'latest.json')]: manifest('0.2.0').replace('win-x64"', 'linux-x64"') };
  expect((await setup({ files }).updater.check()).available).toBe(false);
});

test('latest.json is also found in the app subfolder release --to writes', async () => {
  const root = '\\\\server\\share';
  const { updater } = setup({ folder: root, files: { [join(root, 'Gallery', 'latest.json')]: manifest('0.2.0') } });
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
  const { updater } = setup({ files: { [join(SHARE, 'latest.json')]: '{"version":"x"}' } });
  expect((await updater.check()).status).toBe('error');
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
      [join(SHARE, 'latest.json')]: manifest('0.2.0'),
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
