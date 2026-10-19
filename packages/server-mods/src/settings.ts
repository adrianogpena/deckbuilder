import { join } from 'node:path';
import { EDITOR_NAMES, type EditorId, findEditor, openInEditor, readJsonFile, revealInFolder, writeJsonAtomic } from '@deckbuilderkit/platform';
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
  /** Runs first on every save, with the raw patch and the current settings; a throw rejects the save unchanged. */
  check?: (patch: Record<string, unknown>, prev: T) => Promise<void>;
  /** Runs after every save, with the new and the previous settings. */
  onChange?: (next: T, prev: T) => void;
}

export interface SettingsStore<T extends BaseSettings> {
  dir: string;
  /** Absolute path of settings.json. */
  file: string;
  load(): Promise<T>;
  save(patch: Record<string, unknown>): Promise<T>;
  /** Re-reads settings.json; `changed` when it differs from what the store held (the file was edited outside the app). */
  reload(): Promise<{ changed: boolean; settings: T }>;
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
    await opts.check?.(patch, prev);
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

  async function reload(): Promise<{ changed: boolean; settings: T }> {
    const prev = await load();
    const stored = await readJsonFile(file, isRecord);
    const next = { ...opts.defaults, ...(stored as object | undefined) } as T;
    const changed = JSON.stringify(next) !== JSON.stringify(prev);
    if (changed) cache = next;
    return { changed, settings: cache ?? next };
  }

  return { dir: opts.dir, file, load, save, reload };
}


/** Saves `value` as the `kind` palette when it is a palette id of that kind; an empty string clears it, anything else is ignored. */
function applyPalette(value: unknown, kind: ThemeKind, next: ThemeSettings): void {
  const key = kind === 'dark' ? 'paletteDark' : 'paletteLight';
  if (value === '') delete next[key];
  else if (PALETTES.some((p) => p.id === value && p.kind === kind)) next[key] = value as string;
}

/** Opens `file` in the first editor found (the program chosen in Settings first), else shows it in the file manager. */
async function openSettingsFile(dir: string, file: string): Promise<void> {
  const overrides = ((await readJsonFile(join(dir, 'editors.json'), isRecord).catch(() => undefined)) ?? {}) as Record<string, unknown>;
  for (const id of Object.keys(EDITOR_NAMES) as EditorId[]) {
    const custom = overrides[id];
    const exe = typeof custom === 'string' && custom !== '' ? custom : await findEditor(id).catch(() => null);
    if (!exe) continue;
    try {
      await openInEditor(id, exe, { folder: dir, file });
      return;
    } catch {
      // try the next editor
    }
  }
  await revealInFolder(file);
}

/** GET and PUT /api/settings, `POST /api/settings/open-file` and `GET /api/settings/external` (the file edited outside the app). */
export function settingsRoutes<T extends BaseSettings>(store: SettingsStore<T>): Routes {
  return {
    'GET /api/settings': () => store.load(),
    'PUT /api/settings': async ({ json }) => store.save(await json()),
    'POST /api/settings/open-file': async () => {
      await store.load();
      await openSettingsFile(store.dir, store.file);
      return { ok: true };
    },
    'GET /api/settings/external': () => store.reload(),
  };
}
