import type { SqlClient, SqlRunnerSettings } from '@deckbuilder/sql-ui';
import { api, type WorkbenchSettings } from './api';
import { settingDefault } from './settings';

/** The calls the SQL hooks of `@deckbuilder/sql-ui` make, served by the app's api. */
export const sqlClient: SqlClient = {
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

/** The runner's options from the stored workbench settings, missing ones taken from the settings schema. */
export const sqlRunnerSettings = (s: Pick<WorkbenchSettings, 'results'> & Partial<Pick<WorkbenchSettings, 'maxRows' | 'copyFormat' | 'confirmDestructive' | 'queryTimeout'>>): SqlRunnerSettings => ({
  maxRows: s.maxRows ?? settingDefault<number>('workbench.maxRows'),
  results: s.results,
  copyFormat: s.copyFormat,
  confirmDestructive: s.confirmDestructive ?? settingDefault<boolean>('workbench.confirmDestructive'),
  queryTimeout: s.queryTimeout,
});
