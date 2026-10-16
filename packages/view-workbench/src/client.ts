import type { SqlHistoryEntry } from '@deckbuilder/server-core/protocol';
import type { DbConnection, SqlClient } from '@deckbuilder/sql-ui';

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
