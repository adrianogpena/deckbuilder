import { join } from 'node:path';
import { appHome, createAutostart, pickFolder } from '@deckbuilder/platform';
import { isRecord, updatePublicKey } from '@deckbuilder/server-core';
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
import { isShellId, terminalRoutes, terminalSessions, type ShellId } from '@deckbuilder/terminal/server';
import { type GridItem, validGridItems } from '@deckbuilder/ui/grid';
import { validKeymap, type Keymap } from '@deckbuilder/ui/keybindings';
import { type FileAssociation, validFileAssociations } from '@deckbuilder/ui/file-associations';
import { type FileSettings, validFileSettings } from '@deckbuilder/ui/file-settings';
import { type LogSettings, validLogSettings } from '@deckbuilder/ui/log';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { dbConnections, openRoutes, projects, requests, resolveCwd, routes } from './routes.ts';

export interface Settings extends BaseSettings {
  /** Start at Windows login (exe only). */
  autostart: boolean;
  /** Tray icon, so closing the window keeps the app running; read at startup. */
  closeToTray: boolean;
  /**
   * Folder `deckbuilder release --to` publishes to; empty: GitHub releases when `APP.repo` is set,
   * else no update checks. Set only through the folder dialog of `POST /api/settings/update-folder`.
   */
  updateFolder: string;
  /** The main menu shows only its icons. */
  navCollapsed?: boolean;
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
  /** Workbench screen: split fractions and column widths. */
  workbench?: WorkbenchSettings;
  /** REST screen: split fractions of the editor and the response. */
  rest?: RestSettings;
  /** Terminal screen: the shell new sessions start. */
  terminal?: { shell: ShellId };
  /** Layout of the Terminal screen's tabs (`serialize`); the UI validates it on restore. */
  terminalLayout?: unknown;
}

export interface RestSettings {
  sizes?: { main: [number, number] };
}

export interface WorkbenchSettings {
  sizes?: { main: [number, number]; results: [number, number] };
  widths?: Record<string, number>;
  /** `'demo'` or the id of a database connection record. */
  source?: string;
  /** Most rows a database query returns, 1 to 100 000. */
  maxRows?: number;
  /** The schema sidebar is open. */
  schema?: boolean;
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
  const { sizes, collapsed, expanded, tabs, trees, treeSizes, markdownMode, wrapLines } = r;
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
  return {
    sizes: [sizes[0], sizes[1]],
    collapsed,
    expanded: out,
    ...(trees !== undefined && { trees }),
    ...(pair && { treeSizes: pair }),
    ...(markdownMode !== undefined && { markdownMode }),
    ...(wrapLines !== undefined && { wrapLines }),
    ...(tabs !== undefined && { tabs }),
  };
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
  if (r.source !== undefined) {
    if (typeof r.source !== 'string' || !/^[\w-]{1,64}$/.test(r.source)) return null;
    out.source = r.source;
  }
  if (r.maxRows !== undefined) {
    if (!Number.isInteger(r.maxRows) || r.maxRows < 1 || r.maxRows > 100_000) return null;
    out.maxRows = r.maxRows;
  }
  if (r.schema !== undefined) {
    if (typeof r.schema !== 'boolean') return null;
    out.schema = r.schema;
  }
  return out;
}

/** A copy of `raw` when it is a well-formed REST screen state, else null. */
function validRest(raw: unknown): RestSettings | null {
  if (!isRecord(raw)) return null;
  const out: RestSettings = {};
  if (raw.sizes !== undefined) {
    if (!isRecord(raw.sizes)) return null;
    const main = validPair(raw.sizes.main);
    if (!main) return null;
    out.sizes = { main };
  }
  return out;
}

const dataDir = appHome(APP.id);
const autostart = createAutostart({ name: APP.name });
/** The folder the update-folder dialog returned; `apply` takes it once. */
const pickedUpdateFolder = pickedPaths({ max: 1 });
const settings = settingsStore<Settings>({
  dir: dataDir,
  defaults: { theme: 'dark', autostart: false, closeToTray: false, updateFolder: '' },
  apply(patch, next) {
    if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart;
    if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
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
    const workbench = validWorkbench(patch.workbench);
    if (workbench) next.workbench = workbench;
    const rest = validRest(patch.rest);
    if (rest) next.rest = rest;
    const terminal = patch.terminal as { shell?: unknown } | undefined;
    if (isRecord(terminal) && isShellId(terminal.shell)) next.terminal = { shell: terminal.shell };
    if (typeof patch.terminalLayout === 'object' && patch.terminalLayout !== null && JSON.stringify(patch.terminalLayout).length < MAX_TABS_LAYOUT_BYTES) {
      next.terminalLayout = patch.terminalLayout;
    }
    if (typeof patch.navCollapsed === 'boolean') next.navCollapsed = patch.navCollapsed;
    const keybindings = validKeymap(patch.keybindings);
    if (keybindings) next.keybindings = keybindings;
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

/** Shells of every Terminal tab; they outlive the window's sockets and end at app quit. */
const sessions = terminalSessions();
const terminal = terminalRoutes({ sessions, shell: async () => (await settings.load()).terminal?.shell ?? 'auto', resolveCwd });

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
    ...backupRoutes({ app: { id: APP.id, version: pkg.version }, settings, stores: { projects, dbConnections, requests }, excludeSettings: ['autostart', 'updateFolder'] }),
    ...routes(ctx),
    ...terminal.routes,
  }),
  sockets: terminal.sockets,
  unauthenticated: openRoutes,
  onQuit: () => sessions.closeAll(),
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
