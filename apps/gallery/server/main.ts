import { isAbsolute, join } from 'node:path';
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
import { isShellId, terminalRoutes, terminalSessions, validAppearance, validSchemes, type ColorScheme, type ShellId, type TerminalProfile } from '@deckbuilder/terminal/server';
import { type GridItem, validGridItems } from '@deckbuilder/ui/grid';
import type { ResultFormat } from '@deckbuilder/ui/table';
import { validKeymap, type Keymap } from '@deckbuilder/ui/keybindings';
import { type FileAssociation, validFileAssociations } from '@deckbuilder/ui/file-associations';
import { type FileSettings, validFileSettings } from '@deckbuilder/ui/file-settings';
import { type LogSettings, validLogSettings } from '@deckbuilder/ui/log';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { dbConnections, environments, openRoutes, projects, requests, resolveCwd, restHistoryStore, routes, sqlHistoryStore } from './routes.ts';

export interface Settings extends BaseSettings {
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
  /** Git screen: focused project, sidebar fractions and collapsed state, list or tree, closed sections, History panel; checked by `validGitView`. */
  gitView?: GitViewSettings;
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
  /** Terminal: the shell new sessions start, plus look and behavior, checked by `validTerminal`. */
  terminal?: { shell?: ShellId; profiles?: TerminalProfile[]; schemes?: ColorScheme[]; [field: string]: string | number | boolean | TerminalProfile[] | ColorScheme[] | undefined };
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
  /** Layout of the Terminal screen's tabs (`serialize`); the UI validates it on restore. */
  terminalLayout?: unknown;
}

export interface RestSettings {
  sizes?: { main: [number, number] };
  /** Id of the active REST environment; '' or absent = none. */
  environment?: string;
  /** Entries kept in the REST request history; 0 turns history off. */
  historySize?: number;
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
  /** The SQL history sidebar is open. */
  history?: boolean;
  /** The SQL steps sidebar is open. */
  steps?: boolean;
  /** Project ids allowed to run SQL from the Explorer. */
  explorerProjects?: string[];
  /** Last connection id used per project id. */
  explorerConnections?: Record<string, string>;
  /** How result cells are shown and copied. */
  results?: ResultFormat;
  /** Format of "Copy results": tsv, csv, markdown, json or insert. */
  copyFormat?: 'tsv' | 'csv' | 'markdown' | 'json' | 'insert';
  /** Ask before DROP, TRUNCATE, or a DELETE or UPDATE without WHERE. */
  confirmDestructive?: boolean;
  /** Seconds to wait for a database statement, 0 to 3600; 0 means no limit. */
  queryTimeout?: number;
  historySize?: number;
  /** SQL formatter options; the editor package owns their meaning. */
  format?: Record<string, string | number | boolean>;
  /** The document the Workbench edits; the default script of the connection when omitted. */
  doc?: { kind: 'default' } | { kind: 'file'; project: string; path: string };
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

export interface GitViewSettings {
  project?: string;
  sizes?: [number, number];
  collapsed?: boolean;
  view?: 'list' | 'tree';
  closedSections?: ('merge' | 'staged' | 'changes')[];
  historyOpen?: boolean;
  historySize?: number;
}

const GIT_SECTIONS: unknown[] = ['merge', 'staged', 'changes'];

/** A copy of `raw` when it is a well-formed Git screen state, else null. */
export function validGitView(raw: unknown): GitViewSettings | null {
  const r = raw as Partial<GitViewSettings> | null;
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return null;
  const { project, sizes, collapsed, view, closedSections, historyOpen, historySize } = r;
  if (project !== undefined && (typeof project !== 'string' || project.length > MAX_ID_LENGTH)) return null;
  const pair = sizes === undefined ? undefined : validPair(sizes);
  if (sizes !== undefined && !pair) return null;
  if (collapsed !== undefined && typeof collapsed !== 'boolean') return null;
  if (view !== undefined && view !== 'list' && view !== 'tree') return null;
  if (closedSections !== undefined && (!Array.isArray(closedSections) || closedSections.length > GIT_SECTIONS.length || !closedSections.every((s) => GIT_SECTIONS.includes(s)))) return null;
  if (historyOpen !== undefined && typeof historyOpen !== 'boolean') return null;
  if (historySize !== undefined && (typeof historySize !== 'number' || !(historySize >= 0.1 && historySize <= 0.9))) return null;
  return {
    ...(project !== undefined && { project }),
    ...(pair && { sizes: pair }),
    ...(collapsed !== undefined && { collapsed }),
    ...(view !== undefined && { view }),
    ...(closedSections !== undefined && { closedSections: [...new Set(closedSections)] }),
    ...(historyOpen !== undefined && { historyOpen }),
    ...(historySize !== undefined && { historySize }),
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
  if (r.history !== undefined) {
    if (typeof r.history !== 'boolean') return null;
    out.history = r.history;
  }
  if (r.steps !== undefined) {
    if (typeof r.steps !== 'boolean') return null;
    out.steps = r.steps;
  }
  if (r.explorerProjects !== undefined) {
    if (!Array.isArray(r.explorerProjects) || r.explorerProjects.length > 1000 || !r.explorerProjects.every((id) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id))) return null;
    out.explorerProjects = [...r.explorerProjects];
  }
  if (r.explorerConnections !== undefined) {
    if (!isRecord(r.explorerConnections)) return null;
    const byProject: Record<string, string> = {};
    for (const [project, id] of Object.entries(r.explorerConnections)) {
      if (!/^[\w-]{1,64}$/.test(project) || typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
      byProject[project] = id;
    }
    out.explorerConnections = byProject;
  }
  if (r.results !== undefined) {
    const x = r.results as Partial<ResultFormat> | null;
    if (!isRecord(x)) return null;
    const { nullText, dateFormat, hideMidnight, timestampFormat, thousandsSeparator } = x;
    if (typeof nullText !== 'string' || nullText.length > 64) return null;
    if (typeof dateFormat !== 'string' || dateFormat.length > 64) return null;
    if (typeof timestampFormat !== 'string' || timestampFormat.length > 64) return null;
    if (typeof hideMidnight !== 'boolean' || typeof thousandsSeparator !== 'boolean') return null;
    out.results = { nullText, dateFormat, hideMidnight, timestampFormat, thousandsSeparator };
  }
  if (r.copyFormat !== undefined) {
    if (typeof r.copyFormat !== 'string' || !['tsv', 'csv', 'markdown', 'json', 'insert'].includes(r.copyFormat)) return null;
    out.copyFormat = r.copyFormat;
  }
  if (r.confirmDestructive !== undefined) {
    if (typeof r.confirmDestructive !== 'boolean') return null;
    out.confirmDestructive = r.confirmDestructive;
  }
  if (r.queryTimeout !== undefined) {
    if (typeof r.queryTimeout !== 'number' || !Number.isFinite(r.queryTimeout) || r.queryTimeout < 0 || r.queryTimeout > 3600) return null;
    out.queryTimeout = r.queryTimeout;
  }
  if (r.historySize !== undefined) {
    if (!Number.isInteger(r.historySize) || (r.historySize as number) < 0 || (r.historySize as number) > 10_000) return null;
    out.historySize = r.historySize;
  }
  if (r.format !== undefined) {
    if (!isRecord(r.format)) return null;
    const format: Record<string, string | number | boolean> = {};
    for (const [key, v] of Object.entries(r.format)) {
      if (!/^\w{1,40}$/.test(key) || (typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v)))) return null;
      format[key] = v;
    }
    out.format = format;
  }
  if (r.doc !== undefined) {
    const d = r.doc as unknown;
    if (!isRecord(d)) return null;
    if (d.kind === 'default') out.doc = { kind: 'default' };
    else if (d.kind === 'file') {
      if (typeof d.project !== 'string' || !/^[\w-]{1,64}$/.test(d.project)) return null;
      if (typeof d.path !== 'string' || d.path.length < 1 || d.path.length > 4096) return null;
      out.doc = { kind: 'file', project: d.project, path: d.path };
    } else return null;
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
  if (raw.environment !== undefined) {
    if (typeof raw.environment !== 'string' || (raw.environment !== '' && !/^[\w-]{1,64}$/.test(raw.environment))) return null;
    out.environment = raw.environment;
  }
  if (raw.historySize !== undefined) {
    if (!Number.isInteger(raw.historySize) || (raw.historySize as number) < 0 || (raw.historySize as number) > 5000) return null;
    out.historySize = raw.historySize as number;
  }
  return out;
}

type FieldSpec = 'boolean' | 'string' | readonly [min: number, max: number] | readonly string[];

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
  startScreen: ['home', 'tabs', 'grid', 'explorer', 'workbench', 'rest', 'terminal'],
};
const KEYBOARD_SPEC: Record<string, FieldSpec> = {
  chordTimeout: [500, 10_000],
};
const GIT_SPEC: Record<string, FieldSpec> = {
  diffMode: ['split', 'inline'],
  explorerDecorations: 'boolean',
};
const FONT_WEIGHTS = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const TERMINAL_SPEC: Record<string, FieldSpec> = {
  fontFamily: 'string',
  fontSize: [8, 32],
  cursorStyle: ['block', 'bar', 'underline'],
  cursorBlink: 'boolean',
  scrollback: [100, 100_000],
  copyOnSelect: 'boolean',
  rightClickPaste: 'boolean',
  restoreTabs: 'boolean',
  tabTitle: 'string',
  lineHeight: [1, 2],
  letterSpacing: [0, 10],
  fontWeight: FONT_WEIGHTS,
  fontWeightBold: FONT_WEIGHTS,
  // A preset or custom scheme id; an unknown one follows the app.
  theme: 'string',
  padding: [0, 48],
  scrollbar: ['visible', 'hover', 'hidden'],
  dimUnfocused: [0, 80],
  pasteWarning: ['multiLine', 'large', 'never'],
  pasteLargeSize: [256, 1_000_000],
  trimCopy: 'boolean',
  minimumContrastRatio: [1, 21],
  ligatures: 'boolean',
  gpuAcceleration: ['auto', 'on', 'off'],
  bellStyle: ['tab', 'sound', 'both', 'none'],
  wordSeparators: 'string',
  scrollSensitivity: [1, 10],
  fastScrollSensitivity: [1, 20],
  altIsMeta: 'boolean',
  onExit: ['keep', 'close', 'closeIfClean', 'restart'],
  confirmCloseRunning: 'boolean',
  shellIntegration: 'boolean',
  commandDecorations: 'boolean',
  defaultCwd: 'string',
  defaultProfile: 'string',
};

const MAX_PROFILES = 50;
const PROFILE_KEYS = new Set(['id', 'name', 'shell', 'command', 'args', 'env', 'cwd', 'icon', 'hidden', 'shellIntegration', 'appearance']);
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const strUpTo = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const optional = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);

/** A terminal profile with only known keys and bounded strings; a custom one needs an absolute `command`. */
function validProfile(v: unknown): TerminalProfile | null {
  if (!isRecord(v) || !Object.keys(v).every((k) => PROFILE_KEYS.has(k))) return null;
  if (!strUpTo(v.id, 64) || !v.id || !strUpTo(v.name, 80) || !v.name) return null;
  if (v.shell !== 'custom' && !isShellId(v.shell)) return null;
  if (!optional(v.command, (c) => strUpTo(c, 1024) && isAbsolute(c))) return null;
  if (v.shell === 'custom' && !v.command) return null;
  if (!optional(v.args, (a) => Array.isArray(a) && a.length <= 50 && a.every((x) => strUpTo(x, 1024)))) return null;
  const envOk = (e: unknown) =>
    isRecord(e) && Object.keys(e).length <= 50 && Object.entries(e).every(([k, x]) => k.length <= 128 && ENV_KEY.test(k) && strUpTo(x, 4096));
  if (!optional(v.env, envOk)) return null;
  if (!optional(v.cwd, (c) => strUpTo(c, 1024)) || !optional(v.icon, (c) => strUpTo(c, 64))) return null;
  if (!optional(v.hidden, (b) => typeof b === 'boolean') || !optional(v.shellIntegration, (b) => typeof b === 'boolean')) return null;
  if (!optional(v.appearance, (a) => validAppearance(a) !== null)) return null;
  return v as unknown as TerminalProfile;
}

/** Up to MAX_PROFILES valid profiles with distinct ids, else null. */
function validProfiles(raw: unknown): TerminalProfile[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PROFILES) return null;
  const out = raw.map(validProfile);
  if (out.some((p) => !p)) return null;
  return new Set(out.map((p) => p!.id)).size === out.length ? (out as TerminalProfile[]) : null;
}

/** A copy of `raw` when every key is in `spec` and its value fits, else null. */
function validGroup(raw: unknown, spec: Record<string, FieldSpec>): Record<string, string | number | boolean> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!Object.hasOwn(spec, key)) return null;
    const s = spec[key]!;
    if (s === 'boolean') {
      if (typeof v !== 'boolean') return null;
    } else if (s === 'string') {
      if (typeof v !== 'string' || v.length > 300) return null;
    } else if (typeof s[0] === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < s[0] || v > (s[1] as number)) return null;
    } else if (typeof v !== 'string' || !(s as readonly string[]).includes(v)) return null;
    out[key] = v;
  }
  return out;
}

/** The terminal group: a valid `shell` id plus the fields of `TERMINAL_SPEC`. */
function validTerminal(raw: unknown): Settings['terminal'] | null {
  if (!isRecord(raw)) return null;
  const { shell, profiles, schemes, ...rest } = raw;
  if (shell !== undefined && !isShellId(shell)) return null;
  const validated = profiles === undefined ? undefined : validProfiles(profiles);
  if (validated === null) return null;
  const validSchemeList = schemes === undefined ? undefined : validSchemes(schemes);
  if (validSchemeList === null) return null;
  if (typeof rest.theme === 'string' && !/^[\w.-]{1,64}$/.test(rest.theme)) return null;
  const fields: NonNullable<Settings['terminal']> | null = validGroup(rest, TERMINAL_SPEC);
  if (!fields) return null;
  if (validated) fields.profiles = validated;
  if (validSchemeList) fields.schemes = validSchemeList;
  return shell === undefined ? fields : { ...fields, shell };
}

const dataDir = appHome(APP.id);
const autostart = createAutostart({ name: APP.name });
/** `workbench.historySize` (default 500; 0 = no SQL history). */
const historySizeOf = (s: Settings) => {
  const n = s.workbench?.historySize;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 500;
};
/** `rest.historySize` (default 100; 0 = no REST history). */
const restHistorySizeOf = (s: Settings) => {
  const n = s.rest?.historySize;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 100;
};

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
    const gitView = validGitView(patch.gitView);
    if (gitView) next.gitView = gitView;
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
    const terminal = validTerminal(patch.terminal);
    if (terminal) next.terminal = terminal;
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
    if (typeof patch.terminalLayout === 'object' && patch.terminalLayout !== null && JSON.stringify(patch.terminalLayout).length < MAX_TABS_LAYOUT_BYTES) {
      next.terminalLayout = patch.terminalLayout;
    }
    const keybindings = validKeymap(patch.keybindings);
    if (keybindings) next.keybindings = keybindings;
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

/** Shells of every Terminal tab; they outlive the window's sockets and end at app quit. */
const sessions = terminalSessions();
const terminalSetting = async (key: string) => (await settings.load()).terminal?.[key];
const terminal = terminalRoutes({
  sessions,
  shell: async () => (await settings.load()).terminal?.shell ?? 'auto',
  profiles: async () => (await settings.load()).terminal?.profiles ?? [],
  defaultProfile: async () => {
    const v = await terminalSetting('defaultProfile');
    return typeof v === 'string' ? v : '';
  },
  defaultCwd: async () => {
    const v = await terminalSetting('defaultCwd');
    return typeof v === 'string' ? v : '';
  },
  shellIntegration: async () => (await terminalSetting('shellIntegration')) !== false,
  integrationDir: join(dataDir, 'shell-integration'),
  resolveCwd,
});

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
