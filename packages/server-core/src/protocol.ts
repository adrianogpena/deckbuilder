// Shared by the server and the web UI; keep this file free of runtime imports.

/** Header the web UI sends with the session token. */
export const TOKEN_HEADER = 'x-deckbuilder-token';

/** URL parameter with a one-time launch code; the UI trades it for the session token at SESSION_PATH. */
export const CODE_PARAM = 'c';

/** POST `{ code }` → `{ token }`; the only /api route that takes no token. */
export const SESSION_PATH = '/api/session';

/** Fixed port of `--dev` runs; Vite (port 5173) proxies /api to this port. */
export const DEV_PORT = 7420;
export const VITE_PORT = 5173;

/** JSON body of every failed API call. */
export interface ApiErrorBody {
  kind: string;
  /** Message id for translation (`error.<code>`); "raw" means `message` is shown as-is. */
  code?: string;
  /** English fallback. */
  message: string;
  params?: Record<string, string | number>;
  /** Raw tool output; never translated. */
  detail?: string;
}

/** Identity of an app; each app defines one in its `app.ts`. */
export interface AppIdentity {
  /** Display name: window title, sidebar, terminal output, release file names. */
  name: string;
  /** Lowercase id: data folder (~/.<id>), executable name in help text. */
  id: string;
  /** GitHub `owner/name` that hosts the releases; unset while the app has no remote. */
  repo?: string;
}

/** GET /api/update: what the updater (updateRoutes in @deckbuilder/server-mods) knows. */
export interface UpdateState {
  /** `offline`: the release folder couldn't be read (off VPN, share down); the last good data is kept. */
  status: 'not-configured' | 'ok' | 'offline' | 'error';
  message?: string;
  /** Message id (`error.<code>`) when the UI should show a translated text instead of `message`. */
  code?: string;
  /** The running version. */
  current: string;
  available: boolean;
  /** Newest released version; null before a check succeeded. */
  version: string | null;
  notes: string | null;
  /** False when running from source: the check works but only the exe can replace itself. */
  canApply: boolean;
  /** Epoch ms of the last successful check, and of the next scheduled one. */
  checkedAt: number | null;
  nextAt: number | null;
  /** Id of the update source in use (`folder:<path>`, `github:<repo>`); null when none. */
  source: string | null;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Response bodies above this are cut and marked `truncated`. */
export const HTTP_MAX_BODY_BYTES = 10_000_000;
/** Request limits, shared by the send route, saved drafts and the editor. */
export const HTTP_MAX_HEADERS = 100;
export const HTTP_MAX_BODY_CHARS = 900_000;
export const HTTP_MAX_URL_CHARS = 4096;
export const HTTP_TIMEOUT_MIN_MS = 1_000;
export const HTTP_TIMEOUT_MAX_MS = 300_000;

export interface HttpRequestSpec {
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  /** Default 60_000, HTTP_TIMEOUT_MIN_MS..HTTP_TIMEOUT_MAX_MS. */
  timeoutMs?: number;
  /** Default false: skip TLS certificate checks. */
  insecure?: boolean;
  /** Default true. */
  followRedirects?: boolean;
}

export interface HttpHeaderDraft {
  name: string;
  value: string;
  enabled: boolean;
}

/** A request as the editor holds and saves it; `draftToSpec` (editor) turns it into a spec. */
export interface HttpRequestDraft {
  method: HttpMethod;
  url: string;
  headers: HttpHeaderDraft[];
  body: string;
  bodyLang: 'json' | 'xml' | 'text';
  timeoutMs?: number;
  insecure?: boolean;
  followRedirects?: boolean;
}

export interface HttpResponseInfo {
  /** Key for POST /api/http/save. */
  id: string;
  status: number;
  statusText: string;
  /** Final URL after redirects. */
  url: string;
  redirected: boolean;
  headers: Array<[string, string]>;
  /** Until the headers arrived. */
  ms: number;
  /** Until the body was read. */
  totalMs: number;
  /** Body bytes read. */
  size: number;
  truncated: boolean;
  /** The Content-Type header, '' when absent. */
  contentType: string;
  /** Set for text-like bodies (UTF-8). */
  text?: string;
  /** Set otherwise; the bytes are only reachable through save. */
  binary?: true;
}

/** True when an app id can serve as a URL scheme (`<id>://open/<path>`). */
export const isUrlScheme = (id: string): boolean => /^[a-z][a-z0-9+.-]*$/.test(id);

/** True for a plain object (not null, not an array). */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One `GET /api/fs/tail` answer: the whole lines in bytes `[from, to)` of a file `size` bytes long. */
export interface TailChunk {
  from: number;
  to: number;
  size: number;
  mtime: number;
  text: string;
  /** The unterminated last line being written; `to` stops before it. */
  partial?: string;
  /** The file is shorter than the requested `from` (truncated or rotated). */
  reset?: true;
}

/** `GET /api/fs/info`: one entry's properties; a link is described itself, not its target. Times are epoch ms. */
export interface FsInfo {
  name: string;
  /** Absolute path on disk. */
  fullPath: string;
  type: 'file' | 'dir' | 'symlink';
  size: number;
  /** Null when the file system doesn't record it. */
  created: number | null;
  modified: number;
  accessed: number;
  readOnly: boolean;
}

/** One `GET /api/fs/du` line: running totals; the last one has `done`. */
export interface FsDuProgress {
  files: number;
  dirs: number;
  bytes: number;
  done?: true;
}

/** `GET /api/fs/hash`. */
export interface FsHash {
  sha256: string;
}

export type EditorId = 'vscode' | 'intellij';

/** One entry of `GET /api/editors`. */
export interface EditorInfo {
  id: EditorId;
  name: string;
  /** The program that opens it: the override, else the detected one; null when not found. */
  path: string | null;
  custom: boolean;
}

/** What a record import did, per store. */
export interface ImportResult {
  added: number;
  updated: number;
  removed: number;
  skipped: Array<{ id?: string; code: string; message: string }>;
}

/** `POST /api/backup/inspect`; token null = the file dialog was cancelled. */
export type BackupInspect =
  | { token: null }
  | { token: string; appVersion: string; exportedAt: string; settings: boolean; stores: Array<{ name: string; count: number; known: boolean }> };

/** One side of a file's git state: the porcelain v2 status letter, `.` unchanged, `?` untracked. */
export type GitCode = '.' | 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

/** A changed file, root-relative; one both staged and modified appears twice, once per group. */
export interface GitFile {
  path: string;
  origPath?: string;
  index: GitCode;
  worktree: GitCode;
  group: 'staged' | 'unstaged' | 'untracked' | 'conflict';
}

/** `GET /api/git/status`. */
export interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFile[];
}

/** One entry of `GET /api/git/repos`. */
export interface GitRepoInfo {
  root: string;
  repo: boolean;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  error?: string;
}

/** `GET /api/git/file`: a file at HEAD or in the index. */
export interface GitFileContent {
  text?: string;
  binary?: boolean;
  tooLarge?: boolean;
  missing?: boolean;
}

/** `GET /api/git/diff`. */
export interface GitDiff {
  text: string;
  truncated: boolean;
}

/** One statement of the SQL history (`GET /api/db/history`), newest first. */
export interface SqlHistoryEntry {
  id: string;
  /** The database connection record id. */
  connectionId: string;
  sql: string;
  /** Start time, ms since epoch. */
  at: number;
  /** Duration of the execute call (a query's rows stream later). */
  ms: number;
  /** Rows affected, or rows a query streamed once its rows were read. */
  rows?: number;
  error?: string;
}
