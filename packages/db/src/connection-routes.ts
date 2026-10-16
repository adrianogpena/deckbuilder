import type { Routes } from '@deckbuilderkit/server-core';
import { recordRoutes, type RecordStore } from '@deckbuilderkit/server-mods';
import type { DbSessions } from './sessions.ts';

const BASE = '/api/db/connections';

/** `/api/db/connections` CRUD over the app's connection store; a deleted record's open session is rolled back and closed. */
export function connectionRoutes(store: RecordStore<object>, sessions: Pick<DbSessions, 'close'>): Routes {
  const routes = recordRoutes(store, BASE);
  return {
    ...routes,
    [`DELETE ${BASE}`]: async (rc) => {
      const id = rc.query.get('id');
      const result = await routes[`DELETE ${BASE}`]!(rc);
      if (id) await sessions.close(id);
      return result;
    },
  };
}
