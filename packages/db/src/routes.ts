import { invalid, isRecord, ndjson, notFound, type Routes } from '@deckbuilder/server-core';
import { parseOracleUrl, validUser } from './oracle-url.ts';
import type { SqlHistory } from './history.ts';
import type { DbCredentials, DbSessions } from './sessions.ts';

export interface DbRoutesOptions {
  sessions: DbSessions;
  /** Server-side lookup of a connection record: null when `id` is unknown. Never expose the result. */
  credentials: (id: string) => Promise<DbCredentials | null>;
  /** The Workbench's default script of a connection id: `read` gives '' when there is none yet. */
  scripts: { read: (id: string) => Promise<string>; write: (id: string, text: string) => Promise<void> };
  /** Records every `/api/db/run`; also serves `/api/db/history*`. */
  history?: SqlHistory;
}

const MAX_SQL = 1_000_000;
const MAX_PASSWORD = 1024;
const MAX_ROWS = 100_000;
const ID = /^[\w-]{1,64}$/;
const OWNER = /^[A-Za-z0-9_$#]{1,128}$/;
const MAX_IDS = 10_000;
/** Query runs whose row count is still unknown, by run id: the history entry the streamed rows go to. */
const MAX_PENDING = 200;

const badRequest = () => invalid('badRequest', 'Invalid request.');

/**
 * The Workbench's database API: `POST /api/db/test|connect|run|commit|rollback|disconnect`,
 * `GET /api/db/rows?run=` (NDJSON of row arrays), `GET /api/db/schema?id=&owner=` and `GET /api/db/status?id=`;
 * with `history`, `GET /api/db/history?q=&connection=` and `POST /api/db/history/delete|clear`.
 */
export function dbRoutes({ sessions, credentials, scripts, history }: DbRoutesOptions): Routes {
  const pending = new Map<string, string>();
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
      const creds = await lookup(id);
      const at = Date.now();
      const start = performance.now();
      const record = (extra: { rows?: number; error?: string }) =>
        history?.append({ connectionId: id, sql: b.sql as string, at, ms: Math.round(performance.now() - start), ...extra }).catch(() => null) ?? Promise.resolve(null);
      let result;
      try {
        result = await sessions.run(id, creds, b.sql, { maxRows: maxRows as number | undefined });
      } catch (err) {
        await record({ error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
      const entry = await record(result.kind === 'done' && result.rowsAffected !== undefined ? { rows: result.rowsAffected } : {});
      if (entry && result.kind === 'rows') {
        pending.set(result.run, entry.id);
        if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
      }
      return result;
    },
    'GET /api/db/rows': ({ req, query }) => {
      const run = query.get('run') ?? '';
      if (!/^[\w-]{1,64}$/.test(run)) throw badRequest();
      const entryId = pending.get(run);
      pending.delete(run);
      let count = 0;
      return ndjson(req, async (emit, signal) => {
        try {
          await sessions.rows(run, (item) => {
            if (Array.isArray(item)) count++;
            return emit(item);
          }, signal);
        } finally {
          if (entryId && history) await history.setRows(entryId, count).catch(() => {});
        }
      });
    },
    'GET /api/db/history': async ({ query }) => {
      if (!history) throw notFound('history', 'SQL history is not available.');
      const q = query.get('q') || undefined;
      const connection = query.get('connection') || undefined;
      if ((q !== undefined && q.length > 1000) || (connection !== undefined && !ID.test(connection))) throw badRequest();
      return history.list({ q, connection });
    },
    'POST /api/db/history/delete': async ({ json }) => {
      if (!history) throw notFound('history', 'SQL history is not available.');
      const { ids } = await body(json);
      if (!Array.isArray(ids) || ids.length > MAX_IDS || !ids.every((x) => typeof x === 'string' && x.length <= 64)) throw badRequest();
      await history.delete(ids as string[]);
      return { ok: true };
    },
    'POST /api/db/history/clear': async () => {
      if (!history) throw notFound('history', 'SQL history is not available.');
      await history.clear();
      return { ok: true };
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
