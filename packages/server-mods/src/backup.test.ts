import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { pickFile, saveFileAs } from '@deckbuilder/platform';
import { invalid, type RouteContext } from '@deckbuilder/server-core';
import { backupRoutes } from './backup.ts';
import { recordStore } from './records.ts';
import { type BaseSettings, settingsStore } from './settings.ts';

interface Item {
  title: string;
}

interface Settings extends BaseSettings {
  autostart: boolean;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function validate(input: unknown): Item {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (typeof raw.title !== 'string' || !raw.title) throw invalid('badTitle', 'Title required.');
  return { title: raw.title };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'deckbuilder-backup-'));
  dirs.push(dir);
  const settings = settingsStore<Settings>({
    dir,
    defaults: { theme: 'system', autostart: false },
    apply: (patch, next) => {
      if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart;
    },
  });
  const projects = recordStore<Item>({ dir, name: 'projects', validate });
  const target = { path: join(dir, 'backup.json') as string | null };
  const save = (async () => target.path) as typeof saveFileAs;
  const pick = (async () => target.path) as typeof pickFile;
  const routes = backupRoutes({ app: { id: 'testapp', version: '1.2.3' }, settings, stores: { projects }, excludeSettings: ['autostart'], save, pick });
  const call = (key: string, input: unknown = {}) => Promise.resolve(routes[key]!({ query: new URLSearchParams(), json: async () => input } as unknown as RouteContext));
  const fail = (key: string, input: unknown = {}) => call(key, input).catch((e) => e);
  return { dir, settings, projects, target, call, fail };
}

test('export, inspect and import restore a deleted record and a changed setting', async () => {
  const { settings, projects, target, call } = await setup();
  await settings.save({ theme: 'dark', autostart: true });
  const a = await projects.create({ title: 'a' });

  expect(await call('GET /api/backup/parts')).toEqual({ stores: ['projects'] });
  expect(await call('POST /api/backup/export', { settings: true, stores: ['projects'] })).toEqual({ path: target.path, counts: { projects: 1 } });
  const written = JSON.parse(await readFile(target.path!, 'utf8'));
  expect(written).toMatchObject({ format: 'deckbuilder-backup', version: 1, app: 'testapp', appVersion: '1.2.3', settings: { theme: 'dark' } });
  expect(written.settings).not.toHaveProperty('autostart');

  await settings.save({ theme: 'light', autostart: false });
  await projects.remove(a.id);

  const info = (await call('POST /api/backup/inspect')) as { token: string };
  expect(info).toMatchObject({ appVersion: '1.2.3', settings: true, stores: [{ name: 'projects', count: 1, known: true }] });
  const result = await call('POST /api/backup/import', { token: info.token, settings: true, stores: ['projects'], mode: 'merge' });
  expect(result).toEqual({ settings: true, stores: { projects: { added: 1, updated: 0, removed: 0, skipped: [] } } });
  expect(await settings.load()).toMatchObject({ theme: 'dark', autostart: false });
  expect((await projects.list()).map((r) => [r.id, r.title])).toEqual([[a.id, 'a']]);
});

test('cancelled dialogs return null and an empty export is refused', async () => {
  const { target, call, fail } = await setup();
  expect(await fail('POST /api/backup/export', { settings: false, stores: [] })).toMatchObject({ code: 'backupEmpty' });
  expect(await fail('POST /api/backup/export', { settings: true, stores: ['nope'] })).toMatchObject({ code: 'badRequest' });
  target.path = null;
  expect(await call('POST /api/backup/export', { settings: true, stores: [] })).toEqual({ path: null });
  expect(await call('POST /api/backup/inspect')).toEqual({ token: null });
});

test('a backup of another app, a broken file and a reused token are refused', async () => {
  const { target, call, fail } = await setup();
  await writeFile(target.path!, JSON.stringify({ format: 'deckbuilder-backup', version: 1, app: 'other' }));
  expect(await fail('POST /api/backup/inspect')).toMatchObject({ code: 'backupOtherApp', opts: { params: { app: 'other' } } });
  await writeFile(target.path!, '{ nope');
  expect(await fail('POST /api/backup/inspect')).toMatchObject({ code: 'badBackup' });
  expect(await readFile(target.path!, 'utf8')).toBe('{ nope');
  await writeFile(target.path!, JSON.stringify({ format: 'deckbuilder-backup', version: 1, app: 'testapp', records: { projects: {} } }));
  expect(await fail('POST /api/backup/inspect')).toMatchObject({ code: 'badBackup' });

  await writeFile(target.path!, JSON.stringify({ format: 'deckbuilder-backup', version: 1, app: 'testapp', settings: { theme: 'dark' } }));
  const { token } = (await call('POST /api/backup/inspect')) as { token: string };
  const body = { token, settings: true, stores: [], mode: 'merge' };
  expect(await fail('POST /api/backup/import', { ...body, mode: 'other' })).toMatchObject({ code: 'badRequest' });
  expect(await call('POST /api/backup/import', body)).toEqual({ settings: true, stores: {} });
  expect(await fail('POST /api/backup/import', body)).toMatchObject({ code: 'backupExpired' });
});

test('an unknown store in the file is listed as unknown and not imported', async () => {
  const { projects, target, call } = await setup();
  await projects.create({ title: 'keep' });
  await writeFile(
    target.path!,
    JSON.stringify({ format: 'deckbuilder-backup', version: 1, app: 'testapp', records: { other: [{ id: 'x', title: 'x' }] } }),
  );
  const info = (await call('POST /api/backup/inspect')) as { token: string };
  expect(info).toMatchObject({ settings: false, stores: [{ name: 'other', count: 1, known: false }] });
  const result = await call('POST /api/backup/import', { token: info.token, settings: true, stores: ['other', 'projects'], mode: 'replace' });
  expect(result).toEqual({ settings: false, stores: {} });
  expect((await projects.list()).map((r) => r.title)).toEqual(['keep']);
});
