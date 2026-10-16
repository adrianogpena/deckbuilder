import { join } from 'node:path';
import { appHome, createAutostart, pickFolder } from '@deckbuilder/platform';
import { applyViewSettings, type FieldSpec, mountViews, updatePublicKey, validGroup } from '@deckbuilder/server-core';
import {
  backupRoutes,
  createUpdater,
  folderSource,
  fromPlatform,
  githubSource,
  infoRoutes,
  pickedPaths,
  settingsRoutes,
  settingsStore,
  themeHead,
  updateRoutes,
  type BaseSettings,
} from '@deckbuilder/server-mods';
import { runApp } from '@deckbuilder/shell';
import type { GitServerSettings } from '@deckbuilder/view-git/server';
import { restHistorySizeOf, type RestServerSettings } from '@deckbuilder/view-rest/server';
import type { TerminalServerSettings } from '@deckbuilder/view-terminal/server';
import { historySizeOf, type WorkbenchServerSettings } from '@deckbuilder/view-workbench/server';
import { type GridItem, validGridItems } from '@deckbuilder/ui/grid';
import { validKeymap, type Keymap } from '@deckbuilder/ui/keybindings';
import { type FileAssociation, validFileAssociations } from '@deckbuilder/ui/file-associations';
import { type FileSettings, validFileSettings } from '@deckbuilder/ui/file-settings';
import { type LogSettings, validLogSettings } from '@deckbuilder/ui/log';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { dbConnections, environments, openRoutes, requests, restHistoryStore, routes, sqlHistoryStore } from './routes.ts';
import { projectRoots, projects } from './stores.ts';
import { serverViews } from './views.ts';

export interface Settings extends BaseSettings, TerminalServerSettings, WorkbenchServerSettings, RestServerSettings, GitServerSettings {
  /** Start at Windows login (exe only). */
  autostart: boolean;
  /** Tray icon, so closing the window keeps the app running; read at startup. */
  closeToTray: boolean;
  /** The Settings modal reopens on the last page shown (kept in memory by the UI). */
  rememberSettingsPage: boolean;
  /**
   * Folder `deckbuilder release --to` publishes to; empty: GitHub releases when `APP.repo` is set,
   * else no update checks. Set only through the folder dialog of `POST /api/settings/update-folder`.
   */
  updateFolder: string;
  /** Keybinding overrides by command id, checked by `validKeymap`. */
  keybindings?: Keymap;
  /** Layout of the Tabs screen (`serialize` of `@deckbuilder/ui`'s tabs); the UI validates it on restore. */
  tabsLayout?: unknown;
  /** Layout of the Grid screen, checked by `validGridItems`. */
  gridLayout?: GridItem[];
  /** Explorer screen: sidebar fractions, collapsed state, expanded tree ids per project and the tab layout. */
  explorer?: ExplorerSettings;
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

export interface ExplorerSettings {
  sizes: [number, number];
  collapsed: boolean;
  expanded: Record<string, string[]>;
  /** Project ids shown in the sidebar, 1 or 2. */
  trees?: string[];
  /** Fractions of the two trees when `trees` has 2. */
  treeSizes?: [number, number];
  /** Edit / split / preview of markdown files; live when omitted. */
  markdownMode?: 'live' | 'edit' | 'split' | 'preview';
  /** Wrap long lines in the file editors; on when omitted. */
  wrapLines?: boolean;
  /** Fractions of the SQL editor and its results panel. */
  sqlSizes?: [number, number];
  tabs?: unknown;
}

const MARKDOWN_MODES: unknown[] = ['live', 'edit', 'split', 'preview'];

const GRID_PANELS = ['clock', 'info', 'update', 'list'];

const MAX_TABS_LAYOUT_BYTES = 64 * 1024;
const MAX_EXPANDED_IDS = 2000;
const MAX_ID_LENGTH = 64;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A copy of `raw` when it is a well-formed explorer state within the size limits, else null. */
function validExplorer(raw: unknown): ExplorerSettings | null {
  const r = raw as Partial<ExplorerSettings> | null;
  if (typeof r !== 'object' || r === null) return null;
  const { sizes, collapsed, expanded, tabs, trees, treeSizes, markdownMode, wrapLines, sqlSizes } = r;
  if (!Array.isArray(sizes) || sizes.length !== 2 || !sizes.every((n) => typeof n === 'number' && n >= 0 && n <= 1)) return null;
  if (Math.abs(sizes[0] + sizes[1] - 1) > 0.01) return null;
  if (typeof collapsed !== 'boolean' || typeof expanded !== 'object' || expanded === null || Array.isArray(expanded)) return null;
  const out: Record<string, string[]> = {};
  for (const [project, ids] of Object.entries(expanded)) {
    if (project.length > MAX_ID_LENGTH || !isStringArray(ids) || ids.length > MAX_EXPANDED_IDS) return null;
    out[project] = ids;
  }
  if (tabs !== undefined && (typeof tabs !== 'object' || tabs === null || JSON.stringify(tabs).length >= MAX_TABS_LAYOUT_BYTES)) return null;
  if (trees !== undefined && (!isStringArray(trees) || trees.length < 1 || trees.length > 2 || trees.some((id) => id.length > MAX_ID_LENGTH))) return null;
  const pair = treeSizes === undefined ? undefined : validPair(treeSizes);
  if (treeSizes !== undefined && !pair) return null;
  if (markdownMode !== undefined && !MARKDOWN_MODES.includes(markdownMode)) return null;
  if (wrapLines !== undefined && typeof wrapLines !== 'boolean') return null;
  const sqlPair = sqlSizes === undefined ? undefined : validPair(sqlSizes);
  if (sqlSizes !== undefined && !sqlPair) return null;
  return {
    sizes: [sizes[0], sizes[1]],
    collapsed,
    expanded: out,
    ...(trees !== undefined && { trees }),
    ...(pair && { treeSizes: pair }),
    ...(markdownMode !== undefined && { markdownMode }),
    ...(wrapLines !== undefined && { wrapLines }),
    ...(sqlPair && { sqlSizes: sqlPair }),
    ...(tabs !== undefined && { tabs }),
  };
}

const validPair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && Math.abs(v[0] + v[1] - 1) <= 0.01
    ? [v[0], v[1]]
    : null;

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
  startScreen: ['home', 'tabs', 'grid', 'explorer', 'workbench', 'rest', 'terminal', 'git'],
};
const KEYBOARD_SPEC: Record<string, FieldSpec> = {
  chordTimeout: [500, 10_000],
};
const GIT_SPEC: Record<string, FieldSpec> = {
  diffMode: ['split', 'inline'],
  explorerDecorations: 'boolean',
};
const dataDir = appHome(APP.id);
const autostart = createAutostart({ name: APP.name });
/** The folder the update-folder dialog returned; `apply` takes it once. */
const pickedUpdateFolder = pickedPaths({ max: 1 });
const settings = settingsStore<Settings>({
  dir: dataDir,
  defaults: { theme: 'dark', autostart: false, closeToTray: false, rememberSettingsPage: true, updateFolder: '' },
  apply(patch, next) {
    if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart;
    if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
    if (typeof patch.rememberSettingsPage === 'boolean') next.rememberSettingsPage = patch.rememberSettingsPage;
    // A client may only clear it: a typed path could be any UNC share.
    if (patch.updateFolder === '' || (typeof patch.updateFolder === 'string' && pickedUpdateFolder.take(patch.updateFolder))) {
      next.updateFolder = patch.updateFolder;
    }
    if (typeof patch.tabsLayout === 'object' && patch.tabsLayout !== null && JSON.stringify(patch.tabsLayout).length < MAX_TABS_LAYOUT_BYTES) {
      next.tabsLayout = patch.tabsLayout;
    }
    const gridLayout = validGridItems(patch.gridLayout, GRID_PANELS);
    if (gridLayout) next.gridLayout = gridLayout;
    const explorer = validExplorer(patch.explorer);
    if (explorer) next.explorer = explorer;
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
    const git = validGroup(patch.git, GIT_SPEC);
    if (git) next.git = git;
    const keybindings = validKeymap(patch.keybindings);
    if (keybindings) next.keybindings = keybindings;
    applyViewSettings(serverViews, patch, next as unknown as Record<string, unknown>);
  },
  onChange(next, prev) {
    if (next.autostart !== prev.autostart) void autostart.set(next.autostart);
    sqlHistoryStore.setMax(historySizeOf(next));
    restHistoryStore.setMax(restHistorySizeOf(next));
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
sqlHistoryStore.setMax(historySizeOf(await settings.load()));
restHistoryStore.setMax(restHistorySizeOf(await settings.load()));

const mounted = mountViews(serverViews, { dataDir, settings, stores: { projects, projectRoots, dbConnections, requests, environments, restHistory: restHistoryStore } });

await runApp({
  app: APP,
  routes: (ctx) => ({
    ...infoRoutes({ app: APP, version: pkg.version, dataDir }),
    ...settingsRoutes(settings),
    'POST /api/settings/update-folder': async ({ json }) => {
      const { title } = await json<{ title?: unknown }>();
      const path = await pickFolder({ title: typeof title === 'string' ? title : undefined }).catch(fromPlatform);
      if (path === null) return settings.load();
      pickedUpdateFolder.add(path);
      return settings.save({ updateFolder: path });
    },
    ...updateRoutes(updater, ctx.quit),
    // Machine-specific: autostart writes the Run key, updateFolder is a local or share path.
    ...backupRoutes({ app: { id: APP.id, version: pkg.version }, settings, stores: { projects, dbConnections, requests, environments }, excludeSettings: ['autostart', 'updateFolder'] }),
    ...routes(ctx),
    ...mounted.routes,
  }),
  sockets: mounted.sockets,
  unauthenticated: openRoutes,
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
