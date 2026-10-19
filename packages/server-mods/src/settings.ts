import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@deckbuilderkit/platform';
import { isRecord, type Routes } from '@deckbuilderkit/server-core';
import { ICON_SET_IDS, LAYOUT_MARK_IDS, layoutById } from '@deckbuilderkit/server-core/layouts';
import { PALETTES, ZOOM_LEVELS, type ThemeKind, type ThemeSettings } from '@deckbuilderkit/server-core/palettes';

/** Settings every app gets; apps extend this with their own fields. */
export interface BaseSettings extends ThemeSettings {
  /** UI language (e.g. "en", "pt-BR"); unset means "follow the browser". */
  language?: string;
}

export interface SettingsOptions<T extends BaseSettings> {
  /** Folder of settings.json, usually `appHome(APP.id)`. */
  dir: string;
  defaults: T;
  /** Copies the valid app-specific fields of `patch` onto `next`; unknown or malformed fields are ignored. */
  apply?: (patch: Record<string, unknown>, next: T) => void;
  /** Runs after every save, with the new and the previous settings. */
  onChange?: (next: T, prev: T) => void;
}

export interface SettingsStore<T extends BaseSettings> {
  dir: string;
  load(): Promise<T>;
  save(patch: Record<string, unknown>): Promise<T>;
}

export function settingsStore<T extends BaseSettings>(opts: SettingsOptions<T>): SettingsStore<T> {
  const file = join(opts.dir, 'settings.json');
  let cache: T | null = null;

  async function load(): Promise<T> {
    if (cache) return cache;
    const stored = await readJsonFile(file, isRecord);
    cache = { ...opts.defaults, ...(stored as object | undefined) };
    return cache;
  }

  async function save(patch: Record<string, unknown>): Promise<T> {
    const prev = await load();
    const next: T = { ...prev };
    if (patch.theme === 'system' || patch.theme === 'dark' || patch.theme === 'light') next.theme = patch.theme;
    applyPalette(patch.paletteDark, 'dark', next);
    applyPalette(patch.paletteLight, 'light', next);
    if (ZOOM_LEVELS.includes(patch.zoom as never)) next.zoom = patch.zoom as number;
    if (patch.layout === '') delete next.layout;
    else if (typeof patch.layout === 'string' && layoutById(patch.layout)) next.layout = patch.layout;
    if (patch.icons === '') delete next.icons;
    else if (typeof patch.icons === 'string' && ICON_SET_IDS.includes(patch.icons)) next.icons = patch.icons;
    if (patch.mainMenu === '') delete next.mainMenu;
    else if (patch.mainMenu === 'labels' || patch.mainMenu === 'icons') next.mainMenu = patch.mainMenu;
    if (patch.dock === '') delete next.dock;
    else if (patch.dock === 'left' || patch.dock === 'right') next.dock = patch.dock;
    if (patch.layoutIcon === '') delete next.layoutIcon;
    else if (typeof patch.layoutIcon === 'string' && LAYOUT_MARK_IDS.includes(patch.layoutIcon)) next.layoutIcon = patch.layoutIcon;
    if (typeof patch.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(patch.language)) next.language = patch.language;
    opts.apply?.(patch, next);
    cache = next;
    await writeJsonAtomic(file, next, { mode: 0o600 });
    opts.onChange?.(next, prev);
    return next;
  }

  return { dir: opts.dir, load, save };
}


/** Saves `value` as the `kind` palette when it is a palette id of that kind; an empty string clears it, anything else is ignored. */
function applyPalette(value: unknown, kind: ThemeKind, next: ThemeSettings): void {
  const key = kind === 'dark' ? 'paletteDark' : 'paletteLight';
  if (value === '') delete next[key];
  else if (PALETTES.some((p) => p.id === value && p.kind === kind)) next[key] = value as string;
}

/** GET and PUT /api/settings. */
export function settingsRoutes<T extends BaseSettings>(store: SettingsStore<T>): Routes {
  return {
    'GET /api/settings': () => store.load(),
    'PUT /api/settings': async ({ json }) => store.save(await json()),
  };
}
