import { request } from '@deckbuilderkit/ui';
import type { DbConnection, DbPlanRow, DbRunResult, DbSchema, DbStatus, DbTableDetails, SqlClient } from './types';

/** The default `SqlClient`: the server's `/api/db/*` and demo save routes over fetch. */
export const sqlClient: SqlClient = {
  connections: () => request<DbConnection[]>('GET', '/api/db/connections'),
  saveDemo: (path, text) => request<{ ok: true }>('POST', '/api/demo/save', {}, { path, text }),
  dbRun: (id, sql, maxRows) => request<DbRunResult>('POST', '/api/db/run', {}, { id, sql, maxRows }),
  dbExplain: (id, sql) => request<{ rows: DbPlanRow[] }>('POST', '/api/db/explain', {}, { id, sql }).then((r) => r.rows),
  dbTable: (id, owner, name) => request<DbTableDetails>('GET', '/api/db/table', { id, owner, name }),
  dbSchema: (id, owner) => request<DbSchema>('GET', '/api/db/schema', { id, owner }),
  dbCommit: (id) => request<DbStatus>('POST', '/api/db/commit', {}, { id }),
  dbRollback: (id) => request<DbStatus>('POST', '/api/db/rollback', {}, { id }),
  dbDisconnect: (id) => request<DbStatus>('POST', '/api/db/disconnect', {}, { id }),
  dbStatus: (id) => request<DbStatus>('GET', '/api/db/status', { id }),
};
