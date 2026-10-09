import type { ArchiveContent, SqliteContent } from '@deckbuilder/editor';
import type { HttpRequestDraft } from '@deckbuilder/editor/http';
import type { ThemeSettings } from '@deckbuilder/server-core/palettes';
import type { BackupInspect, EditorInfo, HttpRequestSpec, HttpResponseInfo, ImportResult, TailChunk, UpdateState } from '@deckbuilder/server-core/protocol';

export type { EditorInfo, ImportResult, TailChunk };
import { type FileAssociation, type Keymap, type Language, type LogSettings, request } from '@deckbuilder/ui';

export interface Settings extends ThemeSettings {
  language?: Language;
  /** The main menu shows only its icons. */
  navCollapsed?: boolean;
  /** Keybinding overrides by command id; the server validates it. */
  keybindings?: Keymap;
  autostart: boolean;
  /** Tray icon; read at startup. */
  closeToTray: boolean;
  updateFolder: string;
  /** Layout of the Tabs screen; restored (and validated) by the screen. */
  tabsLayout?: unknown;
  /** Layout of the Grid screen (`GridItem[]`); the server validates it. */
  gridLayout?: unknown;
  /** State of the Explorer screen; the server validates it. */
  explorer?: ExplorerSettings;
  /** Log viewer: highlight words and bookmarks (keyed `<projectId>:<path>`); the server validates it. */
  logs?: LogSettings;
  /** Files opened as another type; the server validates it. */
  fileAssociations?: FileAssociation[];
  /** State of the Workbench screen; the server validates it. */
  workbench?: WorkbenchSettings;
  /** State of the REST screen; the server validates it. */
  rest?: RestSettings;
}

export interface RestSettings {
  sizes?: { main: [number, number] };
}

export interface SavedRequest {
  id: string;
  name: string;
  request: HttpRequestDraft;
  auth?: { hasSecret: true };
}

export type { LogSettings };


export interface WorkbenchSettings {
  sizes?: { main: [number, number]; results: [number, number] };
  widths?: Record<string, number>;
  /** `'demo'` or a database connection id. */
  source?: string;
  /** Most rows a database query returns. */
  maxRows?: number;
  /** The schema sidebar is open. */
  schema?: boolean;
}

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
  tabs?: unknown;
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
}

export type FsRead = { text: string; size: number; mtime: number; truncated: boolean } | { binary: true; size: number; mtime: number };

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
  fsList: (root: string, path: string) => request<{ entries: FsEntry[] }>('GET', '/api/fs/list', { root, path }).then((r) => r.entries),
  fsArchive: (root: string, path: string) => request<ArchiveContent>('GET', '/api/fs/archive', { root, path }),
  fsSqlite: (root: string, path: string, table?: string, offset?: number) =>
    request<SqliteContent>('GET', '/api/fs/sqlite', { root, path, table, offset }),
  fsRead: (root: string, path: string) => request<FsRead>('GET', '/api/fs/read', { root, path }),
  fsCreate: (root: string, path: string, kind: 'file' | 'dir') => request<FsEntry>('POST', '/api/fs/create', {}, { root, path, kind }),
  fsTail: (root: string, path: string, from?: number, max?: number) =>
    request<TailChunk>('GET', '/api/fs/tail', { root, path, from, max }),
  fsSaveRange: (root: string, path: string, from: number) =>
    request<{ path: string | null; bytes?: number }>('POST', '/api/fs/save-range', {}, { root, path, from }),
  fsWrite: (root: string, path: string, text: string, expectedMtime: number) =>
    request<FsEntry>('POST', '/api/fs/write', {}, { root, path, text, expectedMtime }),
  fsRename: (root: string, path: string, name: string) => request<FsEntry>('POST', '/api/fs/rename', {}, { root, path, name }),
  fsMove: (root: string, from: string, to: string) => request<FsEntry>('POST', '/api/fs/move', {}, { root, from, to }),
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
  saveTarget: () => request<{ path: string | null }>('POST', '/api/demo/save-target'),
  saveDemo: (path: string, text: string) => request<{ ok: true }>('POST', '/api/demo/save', {}, { path, text }),
  dbConnections: () => request<DbConnection[]>('GET', '/api/db/connections'),
  createDbConnection: (input: Record<string, unknown>) => request<DbConnection>('POST', '/api/db/connections', {}, input),
  updateDbConnection: (id: string, input: Record<string, unknown>) => request<DbConnection>('PUT', '/api/db/connections', { id }, input),
  deleteDbConnection: (id: string) => request<{ ok: true }>('DELETE', '/api/db/connections', { id }),
  /** Tests a connection form's values; without `password`, record `id`'s saved one is used. */
  dbTest: (input: Record<string, unknown>) => request<{ ok: true }>('POST', '/api/db/test', {}, input),
  dbConnect: (id: string) => request<DbStatus>('POST', '/api/db/connect', {}, { id }),
  dbRun: (id: string, sql: string, maxRows?: number) => request<DbRunResult>('POST', '/api/db/run', {}, { id, sql, maxRows }),
  dbSchema: (id: string, owner?: string) => request<DbSchema>('GET', '/api/db/schema', { id, owner }),
  dbCommit: (id: string) => request<DbStatus>('POST', '/api/db/commit', {}, { id }),
  dbRollback: (id: string) => request<DbStatus>('POST', '/api/db/rollback', {}, { id }),
  dbDisconnect: (id: string) => request<DbStatus>('POST', '/api/db/disconnect', {}, { id }),
  dbStatus: (id: string) => request<DbStatus>('GET', '/api/db/status', { id }),
  requests: () => request<SavedRequest[]>('GET', '/api/requests'),
  createRequest: (input: Record<string, unknown>) => request<SavedRequest>('POST', '/api/requests', {}, input),
  updateRequest: (id: string, input: Record<string, unknown>) => request<SavedRequest>('PUT', '/api/requests', { id }, input),
  importRequestsFile: () => request<{ name?: string; text: string | null }>('POST', '/api/requests/import-file'),
  saveCurl: (text: string) => request<{ path: string | null }>('POST', '/api/requests/save-curl', {}, { text }),
  reorderRequests: (ids: string[]) => request<{ ok: true }>('POST', '/api/requests/order', {}, { ids }),
  deleteRequest: (id: string) => request<{ ok: true }>('DELETE', '/api/requests', { id }),
  httpSend: (httpRequest: HttpRequestSpec, secretRef: string | undefined, signal: AbortSignal) =>
    request<HttpResponseInfo>('POST', '/api/http/send', {}, { request: httpRequest, secretRef }, { signal }),
  httpSave: (id: string) => request<{ path: string | null; bytes?: number }>('POST', '/api/http/save', {}, { id }),
  echo: (text: string) => request<{ text: string; length: number; at: string }>('POST', '/api/echo', {}, { text }),
};
