import type { ArchiveContent, SqliteContent, SqlFormatOptions } from '@deckbuilder/editor';
import type { HttpRequestDraft } from '@deckbuilder/editor/http';
import type { ThemeSettings } from '@deckbuilder/server-core/palettes';
import type { BackupInspect, EditorInfo, FsArchiveFormat, FsCompressRequest, FsCompressResult, FsDuProgress, FsExtractRequest, FsExtractResult, FsHash, FsInfo, GitCommit, GitCommitFile, GitDiff, GitFileContent, GitRepoInfo, GitStatus, HttpRequestSpec, HttpResponseInfo, ImportResult, RestEnvironment, RestEnvironmentInput, RestHistoryEntry, SqlHistoryEntry, TailChunk, UpdateState } from '@deckbuilder/server-core/protocol';

export type { EditorInfo, FsDuProgress, FsHash, FsInfo, ImportResult, TailChunk };
import type { ColorScheme, SessionInfo, TerminalProfile, TerminalProfileInfo } from '@deckbuilder/terminal';
import type { CopyFormat } from './screens/workbench/copy-format';
import { settingDefault, settingDefaults } from './settings';
import { type FileAssociation, type FileSettings, type Keymap, type Language, type LogSettings, type ResultFormat, request, requestUpload, stream } from '@deckbuilder/ui';

export interface Settings extends ThemeSettings {
  language?: Language;
  /** The main menu shows only its icons. */
  /** Keybinding overrides by command id; the server validates it. */
  keybindings?: Keymap;
  autostart: boolean;
  /** Tray icon; read at startup. */
  closeToTray: boolean;
  /** Settings reopens on the last page shown (until the app restarts). */
  rememberSettingsPage: boolean;
  updateFolder: string;
  /** Layout of the Tabs screen; restored (and validated) by the screen. */
  tabsLayout?: unknown;
  /** Layout of the Grid screen (`GridItem[]`); the server validates it. */
  gridLayout?: unknown;
  /** State of the Explorer screen; the server validates it. */
  explorer?: ExplorerSettings;
  /** State of the Git screen; the server validates it. */
  gitView?: GitViewSettings;
  /** Log viewer: highlight words and bookmarks (keyed `<projectId>:<path>`); the server validates it. */
  logs?: LogSettings;
  /** Files opened as another type; the server validates it. */
  fileAssociations?: FileAssociation[];
  /** How text files are saved and how the Explorer shows files; the server validates it. */
  files?: FileSettings;
  /** State of the Workbench screen; the server validates it. */
  workbench?: Partial<WorkbenchSettings>;
  /** State of the REST screen; the server validates it. */
  rest?: RestSettings;
  /** Terminal screen: the shell id new sessions start (`'auto'` when omitted); the server validates it. */
  terminal?: TerminalSettings & { shell?: string };
  /** Fonts, editor font metrics and motion; the server validates it. */
  appearance?: AppearanceSettings;
  /** How text editors behave; the server validates it. */
  editor?: EditorSettings;
  /** Sidebar side, status bar and tabs; the server validates it. */
  window?: WindowSettings;
  /** Closing and notifications; the server validates it. */
  general?: GeneralSettings;
  /** Shortcut behavior; the server validates it. */
  keyboard?: KeyboardSettings;
  /** Git screen behavior; the server validates it. */
  git?: GitSettings;
  /** Layout of the Terminal screen's tabs; restored (and validated) by the screen. */
  terminalLayout?: unknown;
}

export interface AppearanceSettings {
  uiFontFamily?: string;
  editorFontFamily?: string;
  /** Pixels, 8 to 32. */
  editorFontSize?: number;
  /** Multiple of the font size, 1 to 3. */
  editorLineHeight?: number;
  editorLigatures?: boolean;
  reduceMotion?: boolean;
}

export interface EditorSettings {
  /** Width of a tab character in columns, 1 to 8. */
  tabSize?: number;
  insertSpaces?: boolean;
  wordWrap?: boolean;
  lineNumbers?: boolean;
  highlightActiveLine?: boolean;
  renderWhitespace?: 'none' | 'selection' | 'all';
  bracketMatching?: boolean;
  autoCloseBrackets?: boolean;
  cursorStyle?: 'line' | 'block' | 'underline';
  cursorBlink?: boolean;
}

export interface WindowSettings {
  sidebarSide?: 'left' | 'right';
  statusBar?: boolean;
  tabSizing?: 'fit' | 'shrink';
  tabCloseButton?: 'right' | 'left' | 'hidden';
  tabIcons?: boolean;
}

export interface GeneralSettings {
  confirmCloseDirty?: boolean;
  /** Milliseconds a toast stays, 1000 to 60 000; errors stay longer. */
  toastDuration?: number;
  startScreen?: string;
}

export interface KeyboardSettings {
  /** Milliseconds the next key of a multi-step shortcut may take, 500 to 10 000. */
  chordTimeout?: number;
}

export interface GitSettings {
  /** How the Git screen lays out a diff. */
  diffMode?: 'split' | 'inline';
  /** Whether the Explorer tree colours changed files and marks them with their git status. */
  explorerDecorations?: boolean;
}

export interface TerminalSettings {
  fontFamily?: string;
  /** Pixels, 8 to 32. */
  fontSize?: number;
  cursorStyle?: 'block' | 'bar' | 'underline';
  cursorBlink?: boolean;
  /** Lines kept, 100 to 100 000. */
  scrollback?: number;
  copyOnSelect?: boolean;
  rightClickPaste?: boolean;
  restoreTabs?: boolean;
  tabTitle?: string;
  /** 1 to 2. */
  lineHeight?: number;
  /** Pixels, 0 to 10. */
  letterSpacing?: number;
  fontWeight?: TerminalFontWeight;
  fontWeightBold?: TerminalFontWeight;
  /** A preset id ('app', 'dark-plus', ...) or a `schemes` id; an unknown one follows the app. */
  theme?: string;
  /** Custom color schemes (at most 100). */
  schemes?: ColorScheme[];
  /** Pixels, 0 to 48. */
  padding?: number;
  scrollbar?: 'visible' | 'hover' | 'hidden';
  /** Percent, 0 to 80. */
  dimUnfocused?: number;
  pasteWarning?: 'multiLine' | 'large' | 'never';
  /** Characters, 256 to 1 000 000. */
  pasteLargeSize?: number;
  trimCopy?: boolean;
  /** 1 to 21. */
  minimumContrastRatio?: number;
  ligatures?: boolean;
  gpuAcceleration?: 'auto' | 'on' | 'off';
  bellStyle?: 'tab' | 'sound' | 'both' | 'none';
  wordSeparators?: string;
  /** 1 to 10. */
  scrollSensitivity?: number;
  /** 1 to 20. */
  fastScrollSensitivity?: number;
  altIsMeta?: boolean;
  onExit?: 'keep' | 'close' | 'closeIfClean' | 'restart';
  confirmCloseRunning?: boolean;
  /** OSC 133/OSC 7 scripts injected into supported shells; default true. */
  shellIntegration?: boolean;
  commandDecorations?: boolean;
  /** Start directory when the tab and profile give none; `~` = home. */
  defaultCwd?: string;
  /** Profile id for new tabs; '' = the `shell` setting. */
  defaultProfile?: string;
  /** Overrides of built-in profiles (shell id as `id`) and custom profiles. */
  profiles?: TerminalProfile[];
}

export type TerminalFontWeight = 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

export interface RestSettings {
  sizes?: { main: [number, number] };
  /** Id of the active REST environment; '' or absent = none. */
  environment?: string;
  /** Entries kept in the REST request history; 0 turns history off. */
  historySize?: number;
}

export interface SavedRequest {
  id: string;
  name: string;
  request: HttpRequestDraft;
  auth?: { hasSecret: true };
}

export interface RestTabsFile {
  version: 1;
  tabs: Array<{ id: string; draft: HttpRequestDraft; savedId?: string; title?: string }>;
  active?: string;
}

export type { CopyFormat };
export type { LogSettings, ResultFormat, SqlFormatOptions };


export interface WorkbenchSettings {
  sizes?: { main: [number, number]; results: [number, number] };
  widths?: Record<string, number>;
  /** `'demo'` or a database connection id. */
  source?: string;
  /** Most rows a database query returns. */
  maxRows?: number;
  /** The schema sidebar is open. */
  schema?: boolean;
  /** The SQL steps sidebar is open. */
  steps?: boolean;
  /** The SQL history sidebar is open. */
  history?: boolean;
  /** Project ids allowed to run SQL from the Explorer. */
  explorerProjects: string[];
  /** Last connection id used per project id. */
  explorerConnections: Record<string, string>;
  /** How result cells are shown and copied; exports stay raw. */
  results: ResultFormat;
  /** Format of "Copy results". */
  copyFormat: CopyFormat;
  /** Ask before DROP, TRUNCATE, or a DELETE or UPDATE without WHERE. */
  confirmDestructive?: boolean;
  /** Seconds to wait for a database statement; 0 means no limit. */
  queryTimeout?: number;
  /** Statements kept in the SQL history; 0 turns history off. */
  historySize?: number;
  /** SQL formatter options. */
  format: SqlFormatOptions;
  /** The document the editor edits: the connection's default script (also when omitted) or a project file. */
  doc?: WorkbenchDoc;
}

export type WorkbenchDoc = { kind: 'default' } | { kind: 'file'; project: string; path: string };

/** The stored workbench state with every missing field filled from the settings schema. */
export const withWorkbenchDefaults = (raw?: Partial<WorkbenchSettings>): WorkbenchSettings => ({
  ...raw,
  explorerProjects: raw?.explorerProjects ?? settingDefault<string[]>('workbench.explorerProjects'),
  explorerConnections: raw?.explorerConnections ?? {},
  results: { ...settingDefaults<ResultFormat>('workbench.results'), ...raw?.results },
  copyFormat: raw?.copyFormat ?? settingDefault<CopyFormat>('workbench.copyFormat'),
  confirmDestructive: raw?.confirmDestructive ?? settingDefault<boolean>('workbench.confirmDestructive'),
  queryTimeout: raw?.queryTimeout ?? settingDefault<number>('workbench.queryTimeout'),
  historySize: raw?.historySize ?? settingDefault<number>('workbench.historySize'),
  format: { ...settingDefaults<SqlFormatOptions>('workbench.format'), ...raw?.format },
});

export interface DemoRow {
  id: number;
  name: string;
  amount: number;
  date: string;
}

export interface DbConnection {
  id: string;
  name: string;
  url: string;
  user: string;
  password?: { hasSecret: true };
}

export interface DbStatus {
  connected: boolean;
  /** Uncommitted changes may exist. */
  pending: boolean;
  busy: boolean;
}

export interface DbColumn {
  name: string;
  type: 'number' | 'text' | 'date' | 'binary';
  /** A TIMESTAMP column (also reported as type `date`). */
  timestamp?: boolean;
}

export interface DbSchemaTable {
  name: string;
  kind: 'table' | 'view';
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

export interface DbSchema {
  owner: string;
  owners: string[];
  tables: DbSchemaTable[];
  truncated: boolean;
}

export interface DbTableIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface DbTableConstraint {
  name: string;
  /** Primary key, unique, foreign key (references), check. */
  type: 'P' | 'U' | 'R' | 'C';
  columns: string[];
  condition?: string;
  references?: { owner: string; table: string; constraint: string; columns: string[] };
}

export interface DbTableDetails {
  owner: string;
  name: string;
  indexes: DbTableIndex[];
  constraints: DbTableConstraint[];
  ddl: string | null;
}

/** One step of an EXPLAIN PLAN, as PLAN_TABLE holds it. */
export interface DbPlanRow {
  id: number;
  parentId: number | null;
  depth: number;
  operation: string;
  options: string | null;
  objectOwner: string | null;
  objectName: string | null;
  cost: number | null;
  cardinality: number | null;
  bytes: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
}

export type { SqlHistoryEntry };
export type DbRunResult = { kind: 'rows'; run: string; columns: DbColumn[] } | { kind: 'done'; rowsAffected?: number };

export interface ExplorerSettings {
  /** Fractions of the sidebar and the workspace. */
  sizes: [number, number];
  collapsed: boolean;
  /** Expanded tree node ids per project id. */
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

/** Change groups of the Git screen, VS Code's Source Control sections. */
export type GitSection = 'merge' | 'staged' | 'changes';

export interface GitViewSettings {
  /** Id of the focused project. */
  project?: string;
  /** Fractions of the sidebar and the diff. */
  sizes?: [number, number];
  collapsed?: boolean;
  /** Changes as a flat list or nested under folders; list when omitted. */
  view?: 'list' | 'tree';
  /** Sections shown collapsed. */
  closedSections?: GitSection[];
  /** Whether the History panel under the changes is open; closed when omitted. */
  historyOpen?: boolean;
  /** Fraction of the sidebar height the open History panel takes. */
  historySize?: number;
}

export type BackupInfo = BackupInspect;

export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  size: number;
  mtime: number;
  /** A link that leads out of the project folder. */
  outside?: true;
  /** What a link inside the project points to. */
  target?: 'file' | 'dir';
  /** Matches an exclude glob; only listed when the tree shows excluded entries. */
  excluded?: true;
}

/** The text encodings the server reads and writes (`TextEncodingId` of server-mods). */
export type TextEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'windows1252';

export type FsRead =
  | { text: string; encoding: TextEncoding; size: number; mtime: number; truncated: boolean; readOnly?: true }
  | { binary: true; size: number; mtime: number };

export interface SearchHit {
  path: string;
  kind: 'file' | 'dir';
  line?: number;
  text?: string;
}

/** GET /api/info (infoRoutes in @deckbuilder/server-mods). */
export interface Info {
  name: string;
  version: string;
  platform: string;
  arch: string;
  hostname: string;
  bun: string;
  dataDir: string;
  startedAt: string;
}

export const api = {
  info: () => request<Info>('GET', '/api/info'),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', {}, patch),
  /** Shows the server's folder dialog and saves the result as `updateFolder` (unchanged when cancelled). */
  pickUpdateFolder: (title: string) => request<Settings>('POST', '/api/settings/update-folder', {}, { title }),
  update: () => request<UpdateState>('GET', '/api/update'),
  checkUpdate: () => request<UpdateState>('POST', '/api/update/check'),
  applyUpdate: () => request<{ version: string }>('POST', '/api/update/apply'),
  quit: () => request<{ ok: true }>('POST', '/api/quit'),
  testToast: () => request<{ ok: true }>('POST', '/api/toast/test'),
  projects: () => request<Project[]>('GET', '/api/projects'),
  createProject: (input: Record<string, unknown>) => request<Project>('POST', '/api/projects', {}, input),
  updateProject: (id: string, input: Record<string, unknown>) => request<Project>('PUT', '/api/projects', { id }, input),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', '/api/projects', { id }),
  fsList: (root: string, path: string, view?: { exclude?: string[]; sort?: string; all?: boolean }) =>
    request<{ entries: FsEntry[] }>('GET', '/api/fs/list', {
      root,
      path,
      exclude: view?.exclude && JSON.stringify(view.exclude),
      sort: view?.sort,
      all: view?.all ? '1' : undefined,
    }).then((r) => r.entries),
  fsArchive: (root: string, path: string) => request<ArchiveContent>('GET', '/api/fs/archive', { root, path }),
  fsSqlite: (root: string, path: string, table?: string, offset?: number) =>
    request<SqliteContent>('GET', '/api/fs/sqlite', { root, path, table, offset }),
  fsStat: (root: string, path: string) => request<FsEntry>('GET', '/api/fs/stat', { root, path }),
  fsRead: (root: string, path: string) => request<FsRead>('GET', '/api/fs/read', { root, path }),
  fsInfo: (root: string, path: string) => request<FsInfo>('GET', '/api/fs/info', { root, path }),
  /** Streams running totals to `onProgress`; resolves with the final totals, rejects with the abort reason when `signal` aborts. */
  fsDu: async (root: string, path: string, onProgress: (p: FsDuProgress) => void, signal?: AbortSignal) => {
    let last: FsDuProgress = { files: 0, dirs: 0, bytes: 0 };
    await stream('/api/fs/du', { root, path }, (item) => onProgress((last = item as FsDuProgress)), signal);
    return last;
  },
  fsHash: (root: string, path: string) => request<FsHash>('GET', '/api/fs/hash', { root, path }),
  fsExtract: (root: string, path: string, to: string) => request<FsExtractResult>('POST', '/api/fs/extract', {}, { root, path, to } satisfies FsExtractRequest),
  fsCompress: (root: string, paths: string[], name: string, format: FsArchiveFormat) =>
    request<FsCompressResult>('POST', '/api/fs/compress', {}, { root, paths, name, format } satisfies FsCompressRequest),
  gitRepos: () => request<GitRepoInfo[]>('GET', '/api/git/repos'),
  gitStatus: (root: string) => request<GitStatus>('GET', '/api/git/status', { root }),
  gitFile: (root: string, path: string, from: 'head' | 'index' | 'commit' | 'parent', commit?: string) => request<GitFileContent>('GET', '/api/git/file', { root, path, from, ...(commit && { commit }) }),
  gitLog: (root: string, skip: number, limit: number) => request<GitCommit[]>('GET', '/api/git/log', { root, skip, limit }),
  gitCommit: (root: string, commit: string) => request<GitCommitFile[]>('GET', '/api/git/commit', { root, commit }),
  gitDiff: (root: string, path: string, staged: boolean, commit?: string) =>
    request<GitDiff>('GET', '/api/git/diff', { root, path, staged: staged ? '1' : '0', ...(commit && { commit }) }),
  fsCreate: (root: string, path: string, kind: 'file' | 'dir') => request<FsEntry>('POST', '/api/fs/create', {}, { root, path, kind }),
  fsTail: (root: string, path: string, from?: number, max?: number) =>
    request<TailChunk>('GET', '/api/fs/tail', { root, path, from, max }),
  fsSaveRange: (root: string, path: string, from: number) =>
    request<{ path: string | null; bytes?: number }>('POST', '/api/fs/save-range', {}, { root, path, from }),
  /** Without `expectedMtime` it overwrites a file changed on disk; `unlock` clears its read-only flag first. */
  fsWrite: (root: string, path: string, text: string, expectedMtime: number | undefined, encoding?: TextEncoding, unlock?: boolean) =>
    request<FsEntry>('POST', '/api/fs/write', {}, { root, path, text, expectedMtime, encoding, unlock }),
  fsRename: (root: string, path: string, name: string) => request<FsEntry>('POST', '/api/fs/rename', {}, { root, path, name }),
  fsMove: (root: string, from: string, to: string, onExisting?: 'replace' | 'keepBoth') => request<FsEntry>('POST', '/api/fs/move', {}, { root, from, to, onExisting }),
  fsCopy: (root: string, from: string, to: string) => request<FsEntry>('POST', '/api/fs/copy', {}, { root, from, to }),
  /** `path` is the file; missing folders above it are made. Without `onExisting` an existing file gives `exists`. */
  fsUpload: (root: string, path: string, body: Blob, onExisting?: 'replace' | 'keepBoth') =>
    requestUpload<FsEntry>('/api/fs/upload', { root, path, onExisting }, body),
  /** A one-time link for `GET /api/fs/download`, for dragging a file out to the OS. */
  fsDownloadTicket: (root: string, path: string) => request<{ ticket: string; name: string }>('POST', '/api/fs/download-ticket', {}, { root, path }),
  fsDelete: (root: string, paths: string[]) => request<{ ok: true }>('POST', '/api/fs/delete', {}, { root, paths }),
  fsReveal: (root: string, path: string) => request<{ ok: true }>('POST', '/api/fs/reveal', {}, { root, path }),
  fsOpen: (root: string, path: string) => request<{ ok: true }>('POST', '/api/fs/open', {}, { root, path }),
  backupParts: () => request<{ stores: string[] }>('GET', '/api/backup/parts'),
  exportBackup: (settings: boolean, stores: string[]) =>
    request<{ path: string | null; counts?: Record<string, number> }>('POST', '/api/backup/export', {}, { settings, stores }),
  inspectBackup: () => request<BackupInfo>('POST', '/api/backup/inspect'),
  importBackup: (token: string, settings: boolean, stores: string[], mode: 'merge' | 'replace') =>
    request<{ settings: boolean; stores: Record<string, ImportResult> }>('POST', '/api/backup/import', {}, { token, settings, stores, mode }),
  editors: () => request<EditorInfo[]>('GET', '/api/editors'),
  pickEditor: (editor: EditorInfo['id']) => request<EditorInfo[]>('POST', '/api/editors/pick', {}, { editor }),
  resetEditor: (editor: EditorInfo['id']) => request<EditorInfo[]>('DELETE', '/api/editors/override', { editor }),
  openInEditor: (editor: EditorInfo['id'], root: string, path?: string) =>
    request<{ ok: true }>('POST', '/api/editors/open', {}, { editor, root, path: path || undefined }),
  saveTarget: (format: 'csv' | 'json' = 'csv') => request<{ path: string | null }>('POST', '/api/demo/save-target', {}, { format }),
  saveDemo: (path: string, text: string) => request<{ ok: true }>('POST', '/api/demo/save', {}, { path, text }),
  dbConnections: () => request<DbConnection[]>('GET', '/api/db/connections'),
  createDbConnection: (input: Record<string, unknown>) => request<DbConnection>('POST', '/api/db/connections', {}, input),
  updateDbConnection: (id: string, input: Record<string, unknown>) => request<DbConnection>('PUT', '/api/db/connections', { id }, input),
  deleteDbConnection: (id: string) => request<{ ok: true }>('DELETE', '/api/db/connections', { id }),
  /** Tests a connection form's values; without `password`, record `id`'s saved one is used. */
  dbTest: (input: Record<string, unknown>) => request<{ ok: true }>('POST', '/api/db/test', {}, input),
  dbConnect: (id: string) => request<DbStatus>('POST', '/api/db/connect', {}, { id }),
  dbRun: (id: string, sql: string, maxRows?: number) => request<DbRunResult>('POST', '/api/db/run', {}, { id, sql, maxRows }),
  /** Explains `sql` without running it; not recorded in the history. */
  dbExplain: (id: string, sql: string) => request<{ rows: DbPlanRow[] }>('POST', '/api/db/explain', {}, { id, sql }).then((r) => r.rows),
  /** Indexes, constraints and DDL of one table; `notFound` when it is missing. */
  dbTable: (id: string, owner: string, name: string) => request<DbTableDetails>('GET', '/api/db/table', { id, owner, name }),
  dbSchema: (id: string, owner?: string) => request<DbSchema>('GET', '/api/db/schema', { id, owner }),
  dbCommit: (id: string) => request<DbStatus>('POST', '/api/db/commit', {}, { id }),
  dbRollback: (id: string) => request<DbStatus>('POST', '/api/db/rollback', {}, { id }),
  dbDisconnect: (id: string) => request<DbStatus>('POST', '/api/db/disconnect', {}, { id }),
  dbScript: (id: string) => request<{ text: string }>('GET', '/api/db/script', { id }).then((r) => r.text),
  dbScriptSave: (id: string, text: string) => request<{ ok: true }>('PUT', '/api/db/script', { id }, { text }),
  dbStatus: (id: string) => request<DbStatus>('GET', '/api/db/status', { id }),
  listHistory: (filter: { q?: string; connection?: string } = {}) => request<SqlHistoryEntry[]>('GET', '/api/db/history', filter),
  deleteHistory: (ids: string[]) => request<{ ok: true }>('POST', '/api/db/history/delete', {}, { ids }),
  clearHistory: () => request<{ ok: true }>('POST', '/api/db/history/clear'),
  requests: () => request<SavedRequest[]>('GET', '/api/requests'),
  createRequest: (input: Record<string, unknown>) => request<SavedRequest>('POST', '/api/requests', {}, input),
  updateRequest: (id: string, input: Record<string, unknown>) => request<SavedRequest>('PUT', '/api/requests', { id }, input),
  importRequestsFile: () => request<{ name?: string; text: string | null }>('POST', '/api/requests/import-file'),
  saveCurl: (text: string) => request<{ path: string | null }>('POST', '/api/requests/save-curl', {}, { text }),
  reorderRequests: (ids: string[]) => request<{ ok: true }>('POST', '/api/requests/order', {}, { ids }),
  requestAuth: (id: string) => request<{ value: string | null }>('GET', '/api/requests/auth', { id }),
  deleteRequest: (id: string) => request<{ ok: true }>('DELETE', '/api/requests', { id }),
  /** The REST screen's open tabs; never holds an Authorization value. */
  restTabs: () => request<RestTabsFile>('GET', '/api/rest-tabs'),
  saveRestTabs: (file: RestTabsFile) => request<{ ok: true }>('PUT', '/api/rest-tabs', {}, file),
  /** Sends `httpRequest` after substituting `{{name}}` from `environment` (id; omitted = built-ins only); `draft` is the unresolved editor draft for the history. */
  httpSend: (httpRequest: HttpRequestSpec, secretRef: string | undefined, signal: AbortSignal, env: { environment?: string; draft?: HttpRequestDraft } = {}) =>
    request<HttpResponseInfo>('POST', '/api/http/send', {}, { request: httpRequest, secretRef, ...env }, { signal }),
  /** REST environments; secret variables come back with `value: ''` and `set`. */
  restEnvironments: () => request<RestEnvironment[]>('GET', '/api/rest/environments'),
  restEnvironment: (id: string) => request<RestEnvironment>('GET', '/api/rest/environments/item', { id }),
  createRestEnvironment: (input: RestEnvironmentInput) => request<RestEnvironment>('POST', '/api/rest/environments', {}, input),
  updateRestEnvironment: (id: string, input: RestEnvironmentInput) => request<RestEnvironment>('PUT', '/api/rest/environments', { id }, input),
  deleteRestEnvironment: (id: string) => request<{ ok: true }>('DELETE', '/api/rest/environments', { id }),
  reorderRestEnvironments: (ids: string[]) => request<{ ok: true }>('POST', '/api/rest/environments/order', {}, { ids }),
  /** Sent REST requests, newest first; `q` matches method and URL. */
  restHistory: (q = '') => request<RestHistoryEntry[]>('GET', '/api/rest/history', q ? { q } : {}),
  clearRestHistory: () => request<{ ok: true }>('DELETE', '/api/rest/history'),
  httpSave: (id: string) => request<{ path: string | null; bytes?: number }>('POST', '/api/http/save', {}, { id }),
  /** Ids of the shells installed on this machine (no `'auto'`). */
  terminalShells: () => request<string[]>('GET', '/api/terminal/shells'),
  /** Built-in profiles (installed shells, overrides applied), then custom ones, each with `available`. */
  terminalProfiles: () => request<TerminalProfileInfo[]>('GET', '/api/terminal/profiles'),
  /** Every running terminal session, with its title and bell count. */
  terminalSessions: () => request<SessionInfo[]>('GET', '/api/terminal/sessions'),
  echo: (text: string) => request<{ text: string; length: number; at: string }>('POST', '/api/echo', {}, { text }),
};
