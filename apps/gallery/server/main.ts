import { join } from 'node:path';
import { appHome, createAutostart } from '@deckbuilder/platform';
import {
  createUpdater,
  folderSource,
  infoRoutes,
  settingsRoutes,
  settingsStore,
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
  /** Folder `deckbuilder release --to` publishes to; empty means no update checks. */
  updateFolder: string;
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
    return updateFolder ? folderSource(updateFolder, { subfolder: APP.name }) : null;
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
  urlProtocol: true,
  tray: closeToTray,
  async onStart(ctx) {
    setStartContext(ctx);
    updater.start();
    // Repairs the Run entry after the exe moved.
    if ((await settings.load()).autostart) await autostart.fixUp();
  },
});
