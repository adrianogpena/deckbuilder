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
}

const GRID_PANELS = ['clock', 'info', 'update', 'list'];

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
    const gridLayout = validGridItems(patch.gridLayout, GRID_PANELS);
    if (gridLayout) next.gridLayout = gridLayout;
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
