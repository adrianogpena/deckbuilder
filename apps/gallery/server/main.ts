import { join } from 'node:path';
import { appHome, createAutostart } from '@deckbuilder/platform';
import { updatePublicKey } from '@deckbuilder/server-core';
import {
  createUpdater,
  folderSource,
  githubSource,
  infoRoutes,
  settingsRoutes,
  settingsStore,
  themeHead,
  updateRoutes,
  type BaseSettings,
} from '@deckbuilder/server-mods';
import { runApp } from '@deckbuilder/shell';
import { type GridItem, validGridItems } from '@deckbuilder/ui/grid';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { routes } from './routes.ts';

export interface Settings extends BaseSettings {
  /** Start at Windows login (exe only). */
  autostart: boolean;
  /** Tray icon, so closing the window keeps the app running; read at startup. */
  closeToTray: boolean;
  /** Folder `deckbuilder release --to` publishes to; empty: GitHub releases when `APP.repo` is set, else no update checks. */
  updateFolder: string;
  /** Layout of the Tabs screen (`serialize` of `@deckbuilder/ui`'s tabs); the UI validates it on restore. */
  tabsLayout?: unknown;
  /** Layout of the Grid screen, checked by `validGridItems`. */
  gridLayout?: GridItem[];
  /** Explorer screen: sidebar fractions, collapsed state, expanded tree ids per project and the tab layout. */
  explorer?: ExplorerSettings;
  /** Workbench screen: split fractions and column widths. */
  workbench?: WorkbenchSettings;
}

export interface WorkbenchSettings {
  sizes?: { main: [number, number]; results: [number, number] };
  widths?: Record<string, number>;
}

export interface ExplorerSettings {
  sizes: [number, number];
  collapsed: boolean;
  expanded: Record<string, string[]>;
  tabs?: unknown;
}

const GRID_PANELS = ['clock', 'info', 'update', 'list'];

const MAX_TABS_LAYOUT_BYTES = 64 * 1024;
const MAX_EXPANDED_IDS = 2000;
const MAX_ID_LENGTH = 64;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A copy of `raw` when it is a well-formed explorer state within the size limits, else null. */
function validExplorer(raw: unknown): ExplorerSettings | null {
  const r = raw as Partial<ExplorerSettings> | null;
  if (typeof r !== 'object' || r === null) return null;
  const { sizes, collapsed, expanded, tabs } = r;
  if (!Array.isArray(sizes) || sizes.length !== 2 || !sizes.every((n) => typeof n === 'number' && n >= 0 && n <= 1)) return null;
  if (Math.abs(sizes[0] + sizes[1] - 1) > 0.01) return null;
  if (typeof collapsed !== 'boolean' || typeof expanded !== 'object' || expanded === null || Array.isArray(expanded)) return null;
  const out: Record<string, string[]> = {};
  for (const [project, ids] of Object.entries(expanded)) {
    if (project.length > MAX_ID_LENGTH || !isStringArray(ids) || ids.length > MAX_EXPANDED_IDS) return null;
    out[project] = ids;
  }
  if (tabs !== undefined && (typeof tabs !== 'object' || tabs === null || JSON.stringify(tabs).length >= MAX_TABS_LAYOUT_BYTES)) return null;
  return { sizes: [sizes[0], sizes[1]], collapsed, expanded: out, ...(tabs !== undefined && { tabs }) };
}

const WORKBENCH_COLUMNS = ['id', 'name', 'amount', 'date'];

const validPair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && Math.abs(v[0] + v[1] - 1) <= 0.01
    ? [v[0], v[1]]
    : null;

/** A copy of `raw` when it is a well-formed workbench state, else null. */
function validWorkbench(raw: unknown): WorkbenchSettings | null {
  const r = raw as Partial<WorkbenchSettings> | null;
  if (typeof r !== 'object' || r === null) return null;
  const out: WorkbenchSettings = {};
  if (r.sizes !== undefined) {
    const main = validPair(r.sizes?.main);
    const results = validPair(r.sizes?.results);
    if (!main || !results) return null;
    out.sizes = { main, results };
  }
  if (r.widths !== undefined) {
    if (typeof r.widths !== 'object' || r.widths === null || Array.isArray(r.widths)) return null;
    const widths: Record<string, number> = {};
    for (const [id, w] of Object.entries(r.widths)) {
      if (!WORKBENCH_COLUMNS.includes(id) || !Number.isInteger(w) || w < 40 || w > 2000) return null;
      widths[id] = w;
    }
    out.widths = widths;
  }
  return out;
}

const dataDir = appHome(APP.id);
const autostart = createAutostart({ name: APP.name });
const settings = settingsStore<Settings>({
  dir: dataDir,
  defaults: { theme: 'dark', autostart: false, closeToTray: false, updateFolder: '' },
  apply(patch, next) {
    if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart;
    if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
    if (typeof patch.updateFolder === 'string') next.updateFolder = patch.updateFolder.trim();
    if (typeof patch.tabsLayout === 'object' && patch.tabsLayout !== null && JSON.stringify(patch.tabsLayout).length < MAX_TABS_LAYOUT_BYTES) {
      next.tabsLayout = patch.tabsLayout;
    }
    const gridLayout = validGridItems(patch.gridLayout, GRID_PANELS);
    if (gridLayout) next.gridLayout = gridLayout;
    const explorer = validExplorer(patch.explorer);
    if (explorer) next.explorer = explorer;
    const workbench = validWorkbench(patch.workbench);
    if (workbench) next.workbench = workbench;
  },
  onChange(next, prev) {
    if (next.autostart !== prev.autostart) void autostart.set(next.autostart);
    if (next.updateFolder !== prev.updateFolder) void updater.check();
  },
});
const updater = createUpdater({
  version: pkg.version,
  publicKey: updatePublicKey(join(import.meta.dir, '..', 'update-key.pub')),
  source: async () => {
    const { updateFolder } = await settings.load();
    if (updateFolder) return folderSource(updateFolder, { subfolder: APP.name });
    return APP.repo ? githubSource({ repo: APP.repo, tagPrefix: 'gallery-v' }) : null;
  },
});

const { closeToTray } = await settings.load();

await runApp({
  app: APP,
  routes: (ctx) => ({
    ...infoRoutes({ app: APP, version: pkg.version, dataDir }),
    ...settingsRoutes(settings),
    ...updateRoutes(updater, ctx.quit),
    ...routes(ctx),
  }),
  webDir: join(import.meta.dir, '../dist/web'),
  transformIndex: themeHead(settings),
  urlProtocol: true,
  tray: closeToTray,
  async onStart() {
    updater.start();
    // Repairs the Run entry after the exe moved.
    if ((await settings.load()).autostart) await autostart.fixUp();
  },
});
