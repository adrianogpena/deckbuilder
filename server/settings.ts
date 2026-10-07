import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP } from '../shared/app.js';

export interface Settings {
  theme: 'dark' | 'light';
  /** UI language; unset means "follow the browser". */
  language?: 'en' | 'pt-BR';
}

const DEFAULTS: Settings = {
  theme: 'dark',
};

// Outside the install folder, so settings survive reinstalls and updates.
const DIR = join(homedir(), `.${APP.id}`);
const FILE = join(DIR, 'settings.json');

let cache: Settings | null = null;

export function settingsDir(): string {
  return DIR;
}

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(await readFile(FILE, 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

/** Applies only the valid fields of `patch`; unknown or malformed fields are ignored. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await loadSettings()) };
  if (patch.theme === 'dark' || patch.theme === 'light') next.theme = patch.theme;
  if (patch.language === 'en' || patch.language === 'pt-BR') next.language = patch.language;
  cache = next;
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
