import { join } from 'node:path';
import { appHome, createAutostart, setBrowser } from '@deckbuilderkit/platform';
import { applyViewSettings, checkViewSettings, type FieldSpec, forbidden, mountViews, updatePublicKey, validGroup } from '@deckbuilderkit/server-core';
import {
  backupRoutes,
  createUpdater,
  folderSource,
  githubSource,
  infoRoutes,
  pickedPaths,
  fileDialogRoutes,
  settingsRoutes,
  settingsStore,
  themeHead,
  updateRoutes,
  type BaseSettings,
} from '@deckbuilderkit/server-mods';
import { runApp } from '@deckbuilderkit/shell';
import type { ExplorerServerSettings } from '@deckbuilderkit/view-explorer/server';
import type { GitServerSettings } from '@deckbuilderkit/view-git/server';
import type { AgentsServerSettings } from '@deckbuilderkit/view-agents/server';
import { restHistorySizeOf, type RestServerSettings } from '@deckbuilderkit/view-rest/server';
import type { TerminalServerSettings } from '@deckbuilderkit/view-terminal/server';
import { historySizeOf, type WorkbenchServerSettings } from '@deckbuilderkit/view-workbench/server';
import type { DashboardServerSettings, GridServerSettings } from '@deckbuilderkit/view-grid/server';
import { validKeymap, type Keymap } from '@deckbuilderkit/ui/keybindings';
import { type FileAssociation, validFileAssociations } from '@deckbuilderkit/ui/file-associations';
import { type FileSettings, validFileSettings } from '@deckbuilderkit/ui/file-settings';
import { type LogSettings, validLogSettings } from '@deckbuilderkit/ui/log';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { routes } from './routes.ts';
import { stores } from './stores.ts';
import { serverViews, setAppLink } from './views.ts';

export interface Settings extends BaseSettings, TerminalServerSettings, WorkbenchServerSettings, RestServerSettings, GitServerSettings, GridServerSettings, DashboardServerSettings, ExplorerServerSettings, AgentsServerSettings {
  /** Start at Windows login (exe only). */
  autostart: boolean;
  /** Tray icon, so closing the window keeps the app running; read at startup. */
  closeToTray: boolean;
  /** Server port, read at startup; 0 = automatic (the app default). */
  port: number;
  /** The Settings modal reopens on the last page shown (kept in memory by the UI). */
  rememberSettingsPage: boolean;
  /**
   * Folder `deckbuilder release --to` publishes to; empty: GitHub releases when `APP.repo` is set,
   * else no update checks. Set only through the folder dialog of `POST /api/settings/update-folder`.
   */
  updateFolder: string;
  /** Keybinding overrides by command id, checked by `validKeymap`. */
  keybindings?: Keymap;
  /** Layout of the Tabs screen (`serialize` of `@deckbuilderkit/ui`'s tabs); the UI validates it on restore. */
  tabsLayout?: unknown;
  /** Log viewer: highlight words (global) and bookmarks per `<projectId>:<path>`. */
  logs?: LogSettings;
  /** Files opened as another type: a name glob and the extension to treat them as. */
  fileAssociations?: FileAssociation[];
  /** How text files are saved and how the Explorer shows files, checked by `validFileSettings`. */
  files?: FileSettings;
  /** Fonts, editor font metrics and motion, checked by `validGroup`. */
  appearance?: Record<string, string | number | boolean>;
  /** How text editors behave, checked by `validGroup`. */
  editor?: Record<string, string | number | boolean>;
  /** Sidebar side, status bar and tabs, checked by `validGroup`. */
  window?: Record<string, string | number | boolean>;
  /** Closing and notifications, checked by `validGroup`. */
  general?: Record<string, string | number | boolean>;
  /** Shortcut behavior, checked by `validGroup`. */
  keyboard?: Record<string, string | number | boolean>;
  git?: Record<string, string | number | boolean>;
}

const MAX_TABS_LAYOUT_BYTES = 64 * 1024;
const APPEARANCE_SPEC: Record<string, FieldSpec> = {
  uiFontFamily: 'string',
  editorFontFamily: 'string',
  editorFontSize: [8, 32],
  editorLineHeight: [1, 3],
  editorLigatures: 'boolean',
  reduceMotion: 'boolean',
};
const EDITOR_SPEC: Record<string, FieldSpec> = {
  tabSize: [1, 8],
  insertSpaces: 'boolean',
  wordWrap: 'boolean',
  lineNumbers: 'boolean',
  highlightActiveLine: 'boolean',
  renderWhitespace: ['none', 'selection', 'all'],
  bracketMatching: 'boolean',
  autoCloseBrackets: 'boolean',
  cursorStyle: ['line', 'block', 'underline'],
  cursorBlink: 'boolean',
};
const WINDOW_SPEC: Record<string, FieldSpec> = {
  sidebarSide: ['left', 'right'],
  statusBar: 'boolean',
  tabSizing: ['fit', 'shrink'],
  tabCloseButton: ['right', 'left', 'hidden'],
  tabIcons: 'boolean',
};
const GENERAL_SPEC: Record<string, FieldSpec> = {
  confirmCloseDirty: 'boolean',
  toastDuration: [1000, 60_000],
  startScreen: ['home', 'tabs', 'grid', 'dashboard', 'explorer', 'workbench', 'rest', 'terminal', 'git', 'agents'],
  browser: 'string',
};
const KEYBOARD_SPEC: Record<string, FieldSpec> = {
  chordTimeout: [500, 10_000],
};
const dataDir = appHome(APP.id);
const browserOf = (s: Settings) => (typeof s.general?.browser === 'string' ? s.general.browser : undefined);
const autostart = createAutostart({ name: APP.name });
/** The folder the update-folder dialog returned; `apply` takes it once. */
const pickedUpdateFolder = pickedPaths({ max: 1 });
const settings = settingsStore<Settings>({
  dir: dataDir,
  defaults: { theme: 'dark', autostart: false, closeToTray: false, port: 0, rememberSettingsPage: true, updateFolder: '' },
  check: (patch, prev) => checkViewSettings(serverViews, patch, prev as unknown as Record<string, unknown>),
  apply(patch, next) {
    if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart;
    if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
    if (typeof patch.port === 'number' && Number.isInteger(patch.port) && (patch.port === 0 || (patch.port >= 1024 && patch.port <= 65535))) next.port = patch.port;
    if (typeof patch.rememberSettingsPage === 'boolean') next.rememberSettingsPage = patch.rememberSettingsPage;
    // A client may only clear it: a typed path could be any UNC share.
    if (patch.updateFolder === '' || (typeof patch.updateFolder === 'string' && pickedUpdateFolder.take(patch.updateFolder))) {
      next.updateFolder = patch.updateFolder;
    }
    if (typeof patch.tabsLayout === 'object' && patch.tabsLayout !== null && JSON.stringify(patch.tabsLayout).length < MAX_TABS_LAYOUT_BYTES) {
      next.tabsLayout = patch.tabsLayout;
    }
    const logs = validLogSettings(patch.logs);
    if (logs) next.logs = logs;
    const fileAssociations = validFileAssociations(patch.fileAssociations);
    if (fileAssociations) next.fileAssociations = fileAssociations;
    const files = validFileSettings(patch.files);
    if (files) next.files = files;
    const appearance = validGroup(patch.appearance, APPEARANCE_SPEC);
    if (appearance) next.appearance = appearance;
    const editor = validGroup(patch.editor, EDITOR_SPEC);
    if (editor) next.editor = editor;
    const windowGroup = validGroup(patch.window, WINDOW_SPEC);
    if (windowGroup) next.window = windowGroup;
    const general = validGroup(patch.general, GENERAL_SPEC);
    if (general) next.general = general;
    const keyboard = validGroup(patch.keyboard, KEYBOARD_SPEC);
    if (keyboard) next.keyboard = keyboard;
    const keybindings = validKeymap(patch.keybindings);
    if (keybindings) next.keybindings = keybindings;
    applyViewSettings(serverViews, patch, next as unknown as Record<string, unknown>);
  },
  onChange(next, prev) {
    if (next.autostart !== prev.autostart) void autostart.set(next.autostart);
    stores.sqlHistory.setMax(historySizeOf(next));
    stores.restHistory.setMax(restHistorySizeOf(next));
    setBrowser(browserOf(next));
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
setBrowser(browserOf(await settings.load()));
stores.sqlHistory.setMax(historySizeOf(await settings.load()));
stores.restHistory.setMax(restHistorySizeOf(await settings.load()));

const mounted = mountViews(serverViews, { dataDir, settings, stores });

await runApp({
  app: APP,
  // Fixed port so the browser keeps per-origin permissions such as local fonts.
  port: async () => (await settings.load()).port || 27610,
  routes: (ctx) => ({
    ...infoRoutes({ app: APP, version: pkg.version, dataDir }),
    ...settingsRoutes(settings),
    'POST /api/settings/update-folder': async ({ json }) => {
      const { path } = await json<{ path?: unknown }>();
      if (typeof path !== 'string' || !stores.picks.opened.take(path)) throw forbidden('notAPickedFolder', 'Choose the folder first.');
      pickedUpdateFolder.add(path);
      return settings.save({ updateFolder: path });
    },
    ...updateRoutes(updater, ctx.quit),
    // Machine-specific: autostart writes the Run key, updateFolder is a local or share path, port is per machine.
    ...backupRoutes({ app: { id: APP.id, version: pkg.version }, settings, stores: { projects: stores.projects, dbConnections: stores.dbConnections, requests: stores.requests, environments: stores.environments }, excludeSettings: ['autostart', 'updateFolder', 'port'], picks: stores.picks }),
    ...(setAppLink(ctx.link), routes(ctx)),
    ...mounted.routes,
    ...fileDialogRoutes({ home: dataDir, picks: stores.picks }),
    ...(stores.ui.setReveal(ctx.reveal), stores.ui.routes),
  }),
  sockets: { ...mounted.sockets, ...stores.ui.sockets },
  unauthenticated: mounted.unauthenticated,
  onQuit: () => mounted.onQuit(),
  confirmQuit: async () => {
    const messages = await mounted.quitGuard();
    return messages.length === 0 || stores.ui.confirm({ title: APP.name, message: messages.join('\n\n'), okKey: 'confirm.quit', danger: true });
  },
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
