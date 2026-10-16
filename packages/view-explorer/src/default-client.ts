import { type ArchiveContent, httpClient, type SqliteContent } from '@deckbuilderkit/editor';
import type { FsCompressRequest, FsCompressResult, FsExtractRequest, FsExtractResult, FsSaveNewRequest, GitStatus } from '@deckbuilderkit/server-core/protocol';
import { sqlClient } from '@deckbuilderkit/sql-ui';
import { request, requestUpload, stream } from '@deckbuilderkit/ui';
import type { EditorInfo, ExplorerClient, ExplorerClients, FsDuProgress, FsEntry, FsHash, FsInfo, FsRead, Project, TailChunk } from './client';

/** The default `ExplorerClient`: the server's `/api/projects`, `/api/fs/*`, `/api/editors`, `/api/git/status` and `/api/http/save` routes over fetch. */
export const explorerClient: ExplorerClient = {
  projects: () => request<Project[]>('GET', '/api/projects'),
  createProject: (input) => request<Project>('POST', '/api/projects', {}, input),
  updateProject: (id, input) => request<Project>('PUT', '/api/projects', { id }, input),
  deleteProject: (id) => request<{ ok: true }>('DELETE', '/api/projects', { id }),
  fsList: (root, path, view) =>
    request<{ entries: FsEntry[] }>('GET', '/api/fs/list', {
      root,
      path,
      exclude: view?.exclude && JSON.stringify(view.exclude),
      sort: view?.sort,
      all: view?.all ? '1' : undefined,
    }).then((r) => r.entries),
  fsArchive: (root, path) => request<ArchiveContent>('GET', '/api/fs/archive', { root, path }),
  fsSqlite: (root, path, table, offset) => request<SqliteContent>('GET', '/api/fs/sqlite', { root, path, table, offset }),
  fsStat: (root, path) => request<FsEntry>('GET', '/api/fs/stat', { root, path }),
  fsRead: (root, path) => request<FsRead>('GET', '/api/fs/read', { root, path }),
  fsInfo: (root, path) => request<FsInfo>('GET', '/api/fs/info', { root, path }),
  fsDu: async (root, path, onProgress, signal) => {
    let last: FsDuProgress = { files: 0, dirs: 0, bytes: 0 };
    await stream('/api/fs/du', { root, path }, (item) => onProgress((last = item as FsDuProgress)), signal);
    return last;
  },
  fsHash: (root, path) => request<FsHash>('GET', '/api/fs/hash', { root, path }),
  fsExtract: (root, path, to) => request<FsExtractResult>('POST', '/api/fs/extract', {}, { root, path, to } satisfies FsExtractRequest),
  fsCompress: (root, paths, name, format) =>
    request<FsCompressResult>('POST', '/api/fs/compress', {}, { root, paths, name, format } satisfies FsCompressRequest),
  fsCreate: (root, path, kind) => request<FsEntry>('POST', '/api/fs/create', {}, { root, path, kind }),
  fsTail: (root, path, from, max) => request<TailChunk>('GET', '/api/fs/tail', { root, path, from, max }),
  fsSaveRange: (root, path, from) => request<{ path: string | null; bytes?: number }>('POST', '/api/fs/save-range', {}, { root, path, from }),
  fsSaveNew: (body) => request<{ path: string | null }>('POST', '/api/fs/save-new', {}, body satisfies FsSaveNewRequest),
  fsWrite: (root, path, text, expectedMtime, encoding, unlock) =>
    request<FsEntry>('POST', '/api/fs/write', {}, { root, path, text, expectedMtime, encoding, unlock }),
  fsRename: (root, path, name) => request<FsEntry>('POST', '/api/fs/rename', {}, { root, path, name }),
  fsMove: (root, from, to, onExisting) => request<FsEntry>('POST', '/api/fs/move', {}, { root, from, to, onExisting }),
  fsCopy: (root, from, to) => request<FsEntry>('POST', '/api/fs/copy', {}, { root, from, to }),
  fsUpload: (root, path, body, onExisting) => requestUpload<FsEntry>('/api/fs/upload', { root, path, onExisting }, body),
  fsViewTicket: (root, path) => request<{ url: string }>('POST', '/api/fs/view-ticket', {}, { root, path }),
  fsDownloadTicket: (root, path) => request<{ ticket: string; name: string }>('POST', '/api/fs/download-ticket', {}, { root, path }),
  fsDelete: (root, paths) => request<{ ok: true }>('POST', '/api/fs/delete', {}, { root, paths }),
  fsReveal: (root, path) => request<{ ok: true }>('POST', '/api/fs/reveal', {}, { root, path }),
  fsOpen: (root, path) => request<{ ok: true }>('POST', '/api/fs/open', {}, { root, path }),
  editors: () => request<EditorInfo[]>('GET', '/api/editors'),
  openInEditor: (editor, root, path) => request<{ ok: true }>('POST', '/api/editors/open', {}, { editor, root, path: path || undefined }),
  gitStatus: (root) => request<GitStatus>('GET', '/api/git/status', { root }),
  httpSave: (id) => request<{ path: string | null; bytes?: number }>('POST', '/api/http/save', {}, { id }),
};

/** The default `ExplorerClients`: the Explorer's routes plus the default SQL and HTTP clients. */
export const explorerClients: ExplorerClients = { explorer: explorerClient, sql: sqlClient, http: httpClient };
