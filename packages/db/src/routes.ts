import { invalid, isRecord, ndjson, notFound, type Routes } from '@deckbuilder/server-core';
import type { DbCredentials, DbSessions } from './sessions.ts';

export interface DbRoutesOptions {
  sessions: DbSessions;
  /** Server-side lookup of a connection record: null when `id` is unknown. Never expose the result. */
  credentials: (id: string) => Promise<DbCredentials | null>;
}

const MAX_SQL = 1_000_000;
const ID = /^[\w-]{1,64}$/;

const badRequest = () => invalid('badRequest', 'Invalid request.');

/**
 * The Workbench's database API: `POST /api/db/connect|run|commit|rollback|disconnect`,
 * `GET /api/db/rows?run=` (NDJSON of row arrays) and `GET /api/db/status?id=`.
 */
export function dbRoutes({ sessions, credentials }: DbRoutesOptions): Routes {
  function idOf(value: unknown): string {
    if (typeof value !== 'string' || !ID.test(value)) throw badRequest();
    return value;
  }

  async function lookup(id: string): Promise<DbCredentials> {
    const creds = await credentials(id);
    if (!creds) throw notFound('dbConnection', 'This database connection no longer exists.');
    return creds;
  }

  async function body(json: () => Promise<unknown>): Promise<Record<string, unknown>> {
    const b = await json();
    if (!isRecord(b)) throw badRequest();
    return b;
  }

  return {
    'POST /api/db/connect': async ({ json }) => {
      const id = idOf((await body(json)).id);
      return sessions.open(id, await lookup(id));
    },
    'POST /api/db/run': async ({ json }) => {
      const b = await body(json);
      const id = idOf(b.id);
      if (typeof b.sql !== 'string' || b.sql.length > MAX_SQL) throw badRequest();
      return sessions.run(id, await lookup(id), b.sql);
    },
    'GET /api/db/rows': ({ req, query }) => {
      const run = query.get('run') ?? '';
      if (!/^[\w-]{1,64}$/.test(run)) throw badRequest();
      return ndjson(req, (emit, signal) => sessions.rows(run, emit, signal));
    },
    'POST /api/db/commit': async ({ json }) => {
      const id = idOf((await body(json)).id);
      await lookup(id);
      return sessions.commit(id);
    },
    'POST /api/db/rollback': async ({ json }) => {
      const id = idOf((await body(json)).id);
      await lookup(id);
      return sessions.rollback(id);
    },
    // Works for a deleted record too, so its open session can still be closed.
    'POST /api/db/disconnect': async ({ json }) => sessions.close(idOf((await body(json)).id)),
    'GET /api/db/status': ({ query }) => sessions.status(idOf(query.get('id'))),
  };
}
