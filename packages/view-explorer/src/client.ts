import type { ArchiveContent, HttpClient, SqliteContent } from '@deckbuilderkit/editor';
import type { EditorInfo, FsArchiveFormat, FsCompressResult, FsDuProgress, FsExtractResult, FsHash, FsInfo, FsSaveNewRequest, GitStatus, TailChunk } from '@deckbuilderkit/server-core/protocol';
import type { SqlClient } from '@deckbuilderkit/sql-ui';

export type { LogSettings } from '@deckbuilderkit/ui';
export type { EditorInfo, FsDuProgress, FsHash, FsInfo, TailChunk };

/** A project folder the Explorer shows. */
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

/** The text encodings the server reads and writes. */
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

type Done = Promise<{ ok: true }>;
type Existing = 'replace' | 'keepBoth';

/** The server calls the Explorer makes; the app builds it from its api and passes it to `explorerView`. */
export interface ExplorerClient {
  projects: () => Promise<Project[]>;
  createProject: (input: Record<string, unknown>) => Promise<Project>;
  updateProject: (id: string, input: Record<string, unknown>) => Promise<Project>;
  deleteProject: (id: string) => Done;
  fsList: (root: string, path: string, view?: { exclude?: string[]; sort?: string; all?: boolean }) => Promise<FsEntry[]>;
  fsArchive: (root: string, path: string) => Promise<ArchiveContent>;
  fsSqlite: (root: string, path: string, table?: string, offset?: number) => Promise<SqliteContent>;
  fsStat: (root: string, path: string) => Promise<FsEntry>;
  fsRead: (root: string, path: string) => Promise<FsRead>;
  fsInfo: (root: string, path: string) => Promise<FsInfo>;
  fsDu: (root: string, path: string, onProgress: (p: FsDuProgress) => void, signal?: AbortSignal) => Promise<FsDuProgress>;
  fsHash: (root: string, path: string) => Promise<FsHash>;
  fsExtract: (root: string, path: string, to: string) => Promise<FsExtractResult>;
  fsCompress: (root: string, paths: string[], name: string, format: FsArchiveFormat) => Promise<FsCompressResult>;
  fsCreate: (root: string, path: string, kind: 'file' | 'dir') => Promise<FsEntry>;
  fsTail: (root: string, path: string, from?: number, max?: number) => Promise<TailChunk>;
  fsSaveRange: (root: string, path: string, from: number) => Promise<{ path: string | null; bytes?: number }>;
  /** Saves an untitled tab: the save dialog without `path`, else straight to `path` (see `FsSaveNewRequest`). */
  fsSaveNew: (body: FsSaveNewRequest) => Promise<{ path: string | null }>;
  fsWrite: (root: string, path: string, text: string, expectedMtime: number | undefined, encoding?: TextEncoding, unlock?: boolean) => Promise<FsEntry>;
  fsRename: (root: string, path: string, name: string) => Promise<FsEntry>;
  fsMove: (root: string, from: string, to: string, onExisting?: Existing) => Promise<FsEntry>;
  fsCopy: (root: string, from: string, to: string) => Promise<FsEntry>;
  fsUpload: (root: string, path: string, body: Blob, onExisting?: Existing) => Promise<FsEntry>;
  fsViewTicket: (root: string, path: string) => Promise<{ url: string }>;
  fsDownloadTicket: (root: string, path: string) => Promise<{ ticket: string; name: string }>;
  fsDelete: (root: string, paths: string[]) => Done;
  fsReveal: (root: string, path: string) => Done;
  fsOpen: (root: string, path: string) => Done;
  editors: () => Promise<EditorInfo[]>;
  openInEditor: (editor: EditorInfo['id'], root: string, path?: string) => Done;
  /** `ignored`: also list the ignored files and folders. */
  gitStatus: (root: string, ignored?: boolean) => Promise<GitStatus>;
  httpSave: (id: string) => Promise<{ path: string | null; bytes?: number }>;
}

/** Everything the Explorer calls: its own routes plus the SQL and HTTP clients of the capability packages. */
export interface ExplorerClients {
  explorer: ExplorerClient;
  sql: SqlClient;
  http: HttpClient;
}

let current: ExplorerClients | undefined;

/** Set by `explorerView`; the screen and its panels call the server through these. */
export const bindExplorerClient = (clients: ExplorerClients) => {
  current = clients;
};

const bound = <T extends object>(pick: (c: ExplorerClients) => T, name: string): T =>
  new Proxy({} as T, {
    get(_, key) {
      if (!current) throw new Error(`The ${name} client is not bound`);
      return pick(current)[key as keyof T];
    },
  });

export const explorerApi: ExplorerClient = bound((c) => c.explorer, 'Explorer');
export const sqlClient: SqlClient = bound((c) => c.sql, 'SQL');
export const httpClient: HttpClient = bound((c) => c.http, 'HTTP');
