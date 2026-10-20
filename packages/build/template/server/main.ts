import { join } from 'node:path';
import { appHome, createAutostart } from '@deckbuilderkit/platform';
import { applyViewSettings, checkViewSettings, forbidden, mountViews, updatePublicKey } from '@deckbuilderkit/server-core';
import {
  createUpdater,
  fileDialogRoutes,
  folderSource,
  githubSource,
  infoRoutes,
  pickedPaths,
  settingsRoutes,
  settingsStore,
  themeHead,
  uiBroker,
  updateRoutes,
  type BaseSettings,
  type DialogPicks,
} from '@deckbuilderkit/server-mods';
import { runApp } from '@deckbuilderkit/shell';
import { type Keymap, validKeymap } from '@deckbuilderkit/ui/keybindings';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { routes } from './routes.ts';
import { serverViews, stores, type ViewSettings } from './views.ts';

export interface Settings extends BaseSettings, ViewSettings {
  /** Keybinding overrides by command id, checked by `validKeymap`. */
  keybindings?: Keymap;
  /** Start at Windows login (exe only). */
  autostart: boolean;
  /** Tray icon, so closing the window keeps the app running; read at startup. */
  closeToTray: boolean;
  /**
   * Folder `deckbuilder release --to` publishes to; empty: GitHub releases when `APP.repo` is set,
   * else no update checks. Set only through the folder dialog of `POST /api/settings/update-folder`.
   */
  updateFolder: string;
}

const dataDir = appHome(APP.id);
const autostart = createAutostart({ name: APP.name });
/** The folder the update-folder dialog returned; `apply` takes it once. */
const pickedUpdateFolder = pickedPaths({ max: 1 });
const settings = settingsStore<Settings>({
  dir: dataDir,
  defaults: { theme: 'dark', autostart: false, closeToTray: false, updateFolder: '' },
  check: (patch, prev) => checkViewSettings(serverViews, patch, prev as unknown as Record<string, unknown>),
  apply(patch, next) {
    if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart;
    if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
    // A client may only clear it: a typed path could be any UNC share.
    if (patch.updateFolder === '' || (typeof patch.updateFolder === 'string' && pickedUpdateFolder.take(patch.updateFolder))) {
      next.updateFolder = patch.updateFolder;
    }
    const keybindings = validKeymap(patch.keybindings);
    if (keybindings) next.keybindings = keybindings;
    applyViewSettings(serverViews, patch, next as unknown as Record<string, unknown>);
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
    return APP.repo ? githubSource({ repo: APP.repo, tagPrefix: '__APP_DIR__-v' }) : null;
  },
});

const { closeToTray } = await settings.load();
const mounted = mountViews(serverViews, { dataDir, settings, stores });
/** The in-app file dialog's picks and the broker that asks the page questions (confirm dialogs). */
const picks: DialogPicks = { opened: pickedPaths(), saveTargets: pickedPaths() };
const ui = uiBroker();

await runApp({
  app: APP,
  routes: (ctx) => ({
    ...infoRoutes({ app: APP, version: pkg.version, dataDir }),
    ...settingsRoutes(settings),
    'POST /api/settings/update-folder': async ({ json }) => {
      const { path } = await json<{ path?: unknown }>();
      if (typeof path !== 'string' || !picks.opened.take(path)) throw forbidden('notAPickedFolder', 'Choose the folder first.');
      pickedUpdateFolder.add(path);
      return settings.save({ updateFolder: path });
    },
    ...updateRoutes(updater, ctx.quit),
    ...mounted.routes,
    ...fileDialogRoutes({ home: dataDir, picks }),
    ...ui.routes,
    ...routes(ctx),
  }),
  sockets: { ...mounted.sockets, ...ui.sockets },
  unauthenticated: mounted.unauthenticated,
  onQuit: () => mounted.onQuit(),
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
