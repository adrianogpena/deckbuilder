import { join } from 'node:path';
import { appHome, createAutostart } from '@deckbuilder/platform';
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
import { APP } from '../app.ts';
import pkg from '../package.json';
import { routes, setStartContext } from './routes.ts';

export interface Settings extends BaseSettings {
  /** Start at Windows login (exe only). */
  autostart: boolean;
  /** Tray icon, so closing the window keeps the app running; read at startup. */
  closeToTray: boolean;
  /** Folder `deckbuilder release --to` publishes to; empty: GitHub releases when `APP.repo` is set, else no update checks. */
  updateFolder: string;
  /** Layout of the Tabs screen (`serialize` of `@deckbuilder/ui`'s tabs); the UI validates it on restore. */
  tabsLayout?: unknown;
  /** Layout of the Grid screen: `{ id, x, y, w, h, collapsed? }[]`, validated by `validGridLayout`. */
  gridLayout?: GridLayoutItem[];
}

interface GridLayoutItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
}

const GRID_PANELS = ['clock', 'info', 'update', 'list'];
const GRID_COLS = 12;
const MAX_GRID_ITEMS = 50;

const inRange = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** Plain-TS check of the Grid screen layout; anything else is ignored. */
function validGridLayout(value: unknown): value is GridLayoutItem[] {
  if (!Array.isArray(value) || value.length > MAX_GRID_ITEMS) return false;
  return value.every((i) => {
    if (typeof i !== 'object' || i === null) return false;
    const { id, x, y, w, h, collapsed } = i as Record<string, unknown>;
    return typeof id === 'string' && GRID_PANELS.includes(id)
      && inRange(x, 0, GRID_COLS - 1) && inRange(w, 1, GRID_COLS) && x + w <= GRID_COLS
      && inRange(y, 0, 1000) && inRange(h, 1, 100)
      && (collapsed === undefined || typeof collapsed === 'boolean');
  });
}

const MAX_TABS_LAYOUT_BYTES = 64 * 1024;

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
    if (validGridLayout(patch.gridLayout)) next.gridLayout = patch.gridLayout;
  },
  onChange(next, prev) {
    if (next.autostart !== prev.autostart) void autostart.set(next.autostart);
    if (next.updateFolder !== prev.updateFolder) void updater.check();
  },
});
const updater = createUpdater({
  version: pkg.version,
  source: async () => {
    const { updateFolder } = await settings.load();
    if (updateFolder) return folderSource(updateFolder, { subfolder: APP.name });
    return APP.repo ? githubSource({ repo: APP.repo, tagPrefix: 'gallery-v' }) : null;
  },
});

const { closeToTray } = await settings.load();

await runApp({
  app: APP,
  routes: {
    ...infoRoutes({ app: APP, version: pkg.version, dataDir }),
    ...settingsRoutes(settings),
    ...updateRoutes(updater),
    ...routes,
  },
  webDir: join(import.meta.dir, '../dist/web'),
  transformIndex: themeHead(settings),
  urlProtocol: true,
  tray: closeToTray,
  async onStart(ctx) {
    setStartContext(ctx);
    updater.start();
    // Repairs the Run entry after the exe moved.
    if ((await settings.load()).autostart) await autostart.fixUp();
  },
});
