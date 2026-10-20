import type { SqlHistoryEntry } from '@deckbuilderkit/server-core/protocol';
import { type DbConnection, type SqlClient, sqlClient } from '@deckbuilderkit/sql-ui';
import { request } from '@deckbuilderkit/ui';

/** The server calls the Workbench makes; the app builds it from its api and passes it to `workbenchView`. */
export interface WorkbenchClient extends SqlClient {
  createConnection: (input: Record<string, unknown>) => Promise<DbConnection>;
  updateConnection: (id: string, input: Record<string, unknown>) => Promise<DbConnection>;
  deleteConnection: (id: string) => Promise<unknown>;
  testConnection: (input: Record<string, unknown>) => Promise<unknown>;
  /** The default script of a connection. */
  script: (id: string) => Promise<string>;
  saveScript: (id: string, text: string) => Promise<unknown>;
  listHistory: (filter?: { q?: string; connection?: string }) => Promise<SqlHistoryEntry[]>;
  deleteHistory: (ids: string[]) => Promise<unknown>;
  clearHistory: () => Promise<unknown>;
  /** A project file; `text` is missing for a file that is not text. */
  readFile: (root: string, path: string) => Promise<{ text?: string; encoding?: string; mtime?: number; truncated?: boolean }>;
  writeFile: (root: string, path: string, text: string, expectedMtime: number | undefined, encoding?: string) => Promise<{ mtime: number }>;
}

/** The default `WorkbenchClient`: the server's `/api/db/*` and `/api/fs` routes over fetch. */
export const workbenchClient: WorkbenchClient = {
  ...sqlClient,
  createConnection: (input) => request<DbConnection>('POST', '/api/db/connections', {}, input),
  updateConnection: (id, input) => request<DbConnection>('PUT', '/api/db/connections', { id }, input),
  deleteConnection: (id) => request<{ ok: true }>('DELETE', '/api/db/connections', { id }),
  testConnection: (input) => request<{ ok: true }>('POST', '/api/db/test', {}, input),
  script: (id) => request<{ text: string }>('GET', '/api/db/script', { id }).then((r) => r.text),
  saveScript: (id, text) => request<{ ok: true }>('PUT', '/api/db/script', { id }, { text }),
  listHistory: (filter = {}) => request<SqlHistoryEntry[]>('GET', '/api/db/history', filter),
  deleteHistory: (ids) => request<{ ok: true }>('POST', '/api/db/history/delete', {}, { ids }),
  clearHistory: () => request<{ ok: true }>('POST', '/api/db/history/clear'),
  readFile: (root, path) => request<{ text?: string; encoding?: string; mtime?: number; truncated?: boolean }>('GET', '/api/fs/read', { root, path }),
  writeFile: (root, path, text, expectedMtime, encoding) =>
    request<{ mtime: number }>('POST', '/api/fs/write', {}, { root, path, text, expectedMtime, encoding }),
};
