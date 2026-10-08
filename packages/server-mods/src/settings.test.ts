import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BaseSettings, settingsStore } from './settings.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function store(file?: object) {
  const dir = await mkdtemp(join(tmpdir(), 'deckbuilder-settings-'));
  dirs.push(dir);
  if (file) await writeFile(join(dir, 'settings.json'), JSON.stringify(file));
  return { dir, store: settingsStore<BaseSettings>({ dir, defaults: { theme: 'dark' } }) };
}

test('theme and palettes of the right kind are saved', async () => {
  const { dir, store: s } = await store();
  await s.save({ theme: 'system', paletteDark: 'dracula', paletteLight: 'alucard' });
  expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({
    theme: 'system',
    paletteDark: 'dracula',
    paletteLight: 'alucard',
  });
  expect(await s.save({ theme: 'light' })).toMatchObject({ theme: 'light' });
});

test('wrong-kind, unknown and malformed values are ignored, an empty string clears', async () => {
  const { store: s } = await store();
  await s.save({ paletteDark: 'nord', paletteLight: 'catppuccin-latte' });
  expect(await s.save({ theme: 'blue', paletteDark: 'alucard', paletteLight: 'nope' })).toEqual({
    theme: 'dark',
    paletteDark: 'nord',
    paletteLight: 'catppuccin-latte',
  });
  expect(await s.save({ paletteDark: 42, paletteLight: '' })).toEqual({ theme: 'dark', paletteDark: 'nord' });
});

test('an existing settings file keeps working', async () => {
  const { store: s } = await store({ theme: 'light', language: 'pt-BR' });
  expect(await s.load()).toEqual({ theme: 'light', language: 'pt-BR' });
});

test('a corrupt settings file is renamed aside and defaults load', async () => {
  const { dir, store: s } = await store();
  await writeFile(join(dir, 'settings.json'), '{ nope');
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await s.load()).toEqual({ theme: 'dark' });
  } finally {
    err.mockRestore();
  }
  expect((await readdir(dir)).some((name) => name.startsWith('settings.json.corrupt-'))).toBe(true);
});

test('settings that are not a plain object count as corrupt', async () => {
  const { dir, store: s } = await store();
  await writeFile(join(dir, 'settings.json'), '[1, 2]');
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await s.load()).toEqual({ theme: 'dark' });
  } finally {
    err.mockRestore();
  }
  expect((await readdir(dir)).some((name) => name.startsWith('settings.json.corrupt-'))).toBe(true);
});
