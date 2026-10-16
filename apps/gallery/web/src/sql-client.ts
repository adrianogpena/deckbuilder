import { sqlRunnerSettings, type WorkbenchClient } from '@deckbuilder/view-workbench/web';
import type { SqlClient } from '@deckbuilder/sql-ui';
import { api, type TextEncoding } from './api';

export { sqlRunnerSettings };

/** The calls the SQL hooks of `@deckbuilder/sql-ui` make, served by the app's api. */
export const sqlClient: SqlClient = {
  connections: () => api.dbConnections(),
  saveTarget: (format) => api.saveTarget(format),
  saveDemo: (path, text) => api.saveDemo(path, text),
  dbRun: (id, sql, maxRows) => api.dbRun(id, sql, maxRows),
  dbExplain: (id, sql) => api.dbExplain(id, sql),
  dbTable: (id, owner, name) => api.dbTable(id, owner, name),
  dbSchema: (id, owner) => api.dbSchema(id, owner),
  dbCommit: (id) => api.dbCommit(id),
  dbRollback: (id) => api.dbRollback(id),
  dbDisconnect: (id) => api.dbDisconnect(id),
  dbStatus: (id) => api.dbStatus(id),
};

/** What the Workbench view calls: the SQL client plus connections, scripts, history and project files. */
export const workbenchClient: WorkbenchClient = {
  ...sqlClient,
  createConnection: (input) => api.createDbConnection(input),
  updateConnection: (id, input) => api.updateDbConnection(id, input),
  deleteConnection: (id) => api.deleteDbConnection(id),
  testConnection: (input) => api.dbTest(input),
  script: (id) => api.dbScript(id),
  saveScript: (id, text) => api.dbScriptSave(id, text),
  listHistory: (filter) => api.listHistory(filter),
  deleteHistory: (ids) => api.deleteHistory(ids),
  clearHistory: () => api.clearHistory(),
  readFile: (root, path) => api.fsRead(root, path),
  writeFile: (root, path, text, mtime, encoding) => api.fsWrite(root, path, text, mtime, encoding as TextEncoding),
};
