import { invalid, isRecord, ndjson, notFound, type Routes } from '@deckbuilder/server-core';
import { parseOracleUrl, validUser } from './oracle-url.ts';
import type { DbCredentials, DbSessions } from './sessions.ts';

export interface DbRoutesOptions {
  sessions: DbSessions;
  /** Server-side lookup of a connection record: null when `id` is unknown. Never expose the result. */
  credentials: (id: string) => Promise<DbCredentials | null>;
  /** The Workbench's default script of a connection id: `read` gives '' when there is none yet. */
  scripts: { read: (id: string) => Promise<string>; write: (id: string, text: string) => Promise<void> };
}

const MAX_SQL = 1_000_000;
const MAX_PASSWORD = 1024;
const MAX_ROWS = 100_000;
const ID = /^[\w-]{1,64}$/;
const OWNER = /^[A-Za-z0-9_$#]{1,128}$/;

const badRequest = () => invalid('badRequest', 'Invalid request.');

/**
 * The Workbench's database API: `POST /api/db/test|connect|run|commit|rollback|disconnect`,
 * `GET /api/db/rows?run=` (NDJSON of row arrays), `GET /api/db/schema?id=&owner=` and `GET /api/db/status?id=`.
 */
export function dbRoutes({ sessions, credentials, scripts }: DbRoutesOptions): Routes {
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
    // Tests a connection form's values (`url`, `user`, `password`) without keeping a session. An absent
    // password means the saved one of record `id`, as the form leaves out a password that wasn't touched.
    'POST /api/db/test': async ({ json }) => {
      const b = await body(json);
      const { connectString } = parseOracleUrl(b.url);
      const user = validUser(b.user);
      let password = '';
      if (typeof b.password === 'string') password = b.password;
      else if (b.password !== undefined) throw badRequest();
      else if (b.id !== undefined) {
        const saved = await lookup(idOf(b.id));
        if (saved.connectString !== connectString || saved.user !== user) throw badRequest();
        password = saved.password;
      }
      if (password.length > MAX_PASSWORD) throw badRequest();
      await sessions.test({ connectString, user, password });
      return { ok: true };
    },
    'POST /api/db/connect': async ({ json }) => {
      const id = idOf((await body(json)).id);
      return sessions.open(id, await lookup(id));
    },
    'POST /api/db/run': async ({ json }) => {
      const b = await body(json);
      const id = idOf(b.id);
      if (typeof b.sql !== 'string' || b.sql.length > MAX_SQL) throw badRequest();
      const maxRows = b.maxRows;
      if (maxRows !== undefined && !(Number.isInteger(maxRows) && (maxRows as number) >= 1 && (maxRows as number) <= MAX_ROWS)) throw badRequest();
      return sessions.run(id, await lookup(id), b.sql, { maxRows: maxRows as number | undefined });
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
    'GET /api/db/schema': async ({ query }) => {
      const id = idOf(query.get('id'));
      const owner = query.get('owner') || undefined;
      if (owner !== undefined && !OWNER.test(owner)) throw badRequest();
      return sessions.schema(id, await lookup(id), owner);
    },
    'GET /api/db/script': async ({ query }) => ({ text: await scripts.read(idOf(query.get('id'))) }),
    'PUT /api/db/script': async ({ query, json }) => {
      const id = idOf(query.get('id'));
      const { text } = await body(json);
      if (typeof text !== 'string' || text.length > MAX_SQL) throw badRequest();
      await scripts.write(id, text);
      return { ok: true };
    },
    'GET /api/db/status': ({ query }) => sessions.status(idOf(query.get('id'))),
  };
}
