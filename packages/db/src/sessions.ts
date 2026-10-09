import { createHash, randomUUID } from 'node:crypto';
import oracledb, { type FetchMetadata, type FetchTypeResult } from 'oracledb';
import { AppError, type Emit, invalid, notFound } from '@deckbuilder/server-core';

export interface DbCredentials {
  connectString: string;
  user: string;
  password: string;
}

export interface DbColumnMeta {
  name: string;
  dbType?: { name: string };
}

export interface DbResultSet {
  getRows(n: number): Promise<unknown[][]>;
  close(): Promise<void>;
}

/** The part of an oracledb connection the sessions use; tests pass a fake. */
export interface DbConnection {
  execute(sql: string, binds: unknown[], options: Record<string, unknown>): Promise<{
    metaData?: DbColumnMeta[];
    resultSet?: DbResultSet;
    rowsAffected?: number;
  }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  break(): Promise<void>;
  close(): Promise<void>;
}

export type DbColumnType = 'number' | 'text' | 'date' | 'binary';
export interface DbColumn {
  name: string;
  type: DbColumnType;
}

export type DbRunResult =
  | { kind: 'rows'; run: string; columns: DbColumn[] }
  | { kind: 'done'; rowsAffected?: number };

export interface DbStatus {
  connected: boolean;
  /** Uncommitted changes may exist. */
  pending: boolean;
  busy: boolean;
}

export interface DbSessionsOptions {
  connect?: (c: DbCredentials) => Promise<DbConnection>;
  /** A session without a call for this long is rolled back and closed. */
  idleMs?: number;
  /** Most rows one query streams; then `{ $truncated: true }` ends it. */
  maxRows?: number;
  fetchBatch?: number;
}

export interface DbSessions {
  /** Opens the session of connection record `id` (or reuses it) and reports its status. */
  open(id: string, creds: DbCredentials): Promise<DbStatus>;
  run(id: string, creds: DbCredentials, sql: string): Promise<DbRunResult>;
  /** Streams the rows of a `run` result, then closes its result set. */
  rows(run: string, emit: Emit, signal: AbortSignal): Promise<void>;
  commit(id: string): Promise<DbStatus>;
  rollback(id: string): Promise<DbStatus>;
  /** Rolls back and closes. */
  close(id: string): Promise<DbStatus>;
  status(id: string): DbStatus;
  /** Rolls back and closes every session, e.g. on shutdown. */
  closeAll(): Promise<void>;
}

interface OpenResult {
  run: string;
  rs: DbResultSet;
  streaming: boolean;
}

interface Session {
  fingerprint: string;
  creds: DbCredentials;
  conn: Promise<DbConnection>;
  connected: boolean;
  pending: boolean;
  executing: boolean;
  result?: OpenResult;
  timer?: ReturnType<typeof setTimeout>;
}

const DISCONNECTED: DbStatus = { connected: false, pending: false, busy: false };

const busyError = () => invalid('dbBusy', 'A statement is still running on this connection.');

/**
 * One Oracle session per connection record, with an explicit transaction: statements run with
 * `autoCommit: false`, and DML stays pending until `commit` or `rollback`. Closing (also on idle)
 * rolls back. Driver errors become AppErrors whose texts never contain the password.
 */
export function dbSessions(opts: DbSessionsOptions = {}): DbSessions {
  const connect = opts.connect ?? defaultConnect;
  const idleMs = opts.idleMs ?? 900_000;
  const maxRows = opts.maxRows ?? 100_000;
  const fetchBatch = opts.fetchBatch ?? 500;
  const sessions = new Map<string, Session>();
  const runs = new Map<string, string>();

  const isBusy = (s: Session) => s.executing || s.result !== undefined;
  const statusOf = (s: Session | undefined): DbStatus =>
    s ? { connected: s.connected, pending: s.pending, busy: isBusy(s) } : DISCONNECTED;

  function touch(id: string, s: Session) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      if (sessions.get(id) !== s) return;
      if (s.executing || s.result?.streaming) touch(id, s);
      else void closeSession(id, s);
    }, idleMs);
    (s.timer as { unref?: () => void }).unref?.();
  }

  async function closeSession(id: string, s: Session): Promise<void> {
    clearTimeout(s.timer);
    if (sessions.get(id) === s) sessions.delete(id);
    const result = s.result;
    s.result = undefined;
    if (result) runs.delete(result.run);
    const conn = await s.conn.catch(() => null);
    if (!conn) return;
    if (result) {
      if (result.streaming) await conn.break().catch(() => {});
      await result.rs.close().catch(() => {});
    }
    await conn.rollback().catch(() => {});
    await conn.close().catch(() => {});
  }

  async function session(id: string, creds: DbCredentials): Promise<Session> {
    const fingerprint = fingerprintOf(creds);
    let s = sessions.get(id);
    if (s && s.fingerprint !== fingerprint) {
      if (s.pending) throw invalid('dbPendingChanges', 'Commit or roll back the pending changes first.');
      if (isBusy(s)) throw busyError();
      await closeSession(id, s);
      s = sessions.get(id);
    }
    if (!s || s.fingerprint !== fingerprint) {
      const created: Session = {
        fingerprint,
        creds,
        conn: connect(creds),
        connected: false,
        pending: false,
        executing: false,
      };
      sessions.set(id, created);
      s = created;
    }
    touch(id, s);
    try {
      await s.conn;
      s.connected = true;
    } catch (err) {
      if (sessions.get(id) === s) {
        sessions.delete(id);
        clearTimeout(s.timer);
      }
      throw mapError(err, s.creds);
    }
    return s;
  }

  async function run(id: string, creds: DbCredentials, sql: string): Promise<DbRunResult> {
    const statement = prepareSql(sql);
    if (!statement) throw invalid('badRequest', 'Invalid request.');
    const s = await session(id, creds);
    if (isBusy(s)) throw busyError();
    s.executing = true;
    try {
      const conn = await s.conn;
      const kind = statementKind(statement);
      if (kind === 'query') {
        const r = await conn.execute(statement, [], {
          autoCommit: false,
          resultSet: true,
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          fetchTypeHandler,
        });
        const columns = (r.metaData ?? []).map((m) => ({ name: m.name, type: columnType(m.dbType?.name) }));
        if (!r.resultSet) return { kind: 'done' };
        const result = { run: randomUUID(), rs: r.resultSet, streaming: false };
        s.result = result;
        runs.set(result.run, id);
        return { kind: 'rows', run: result.run, columns };
      }
      const r = await conn.execute(statement, [], { autoCommit: false });
      if (kind === 'ddl' || kind === 'end') s.pending = false;
      else s.pending = true;
      return r.rowsAffected === undefined ? { kind: 'done' } : { kind: 'done', rowsAffected: r.rowsAffected };
    } catch (err) {
      throw mapError(err, s.creds);
    } finally {
      s.executing = false;
      touch(id, s);
    }
  }

  async function rows(run: string, emit: Emit, signal: AbortSignal): Promise<void> {
    const id = runs.get(run);
    const s = id === undefined ? undefined : sessions.get(id);
    const result = s?.result;
    if (id === undefined || !s || result?.run !== run || result.streaming) {
      throw notFound('dbResultGone', 'This result is no longer available; run the statement again.');
    }
    result.streaming = true;
    const conn = await s.conn;
    const stop = () => { void conn.break().catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });
    try {
      let count = 0;
      while (!signal.aborted) {
        if (count >= maxRows) {
          const more = await result.rs.getRows(1);
          if (more.length) await emit({ $truncated: true });
          break;
        }
        const batch = await result.rs.getRows(Math.min(fetchBatch, maxRows - count));
        touch(id, s);
        for (const row of batch) {
          if (signal.aborted) break;
          await emit(row);
        }
        count += batch.length;
        if (batch.length === 0) break;
      }
    } catch (err) {
      if (!signal.aborted) throw mapError(err, s.creds);
    } finally {
      signal.removeEventListener('abort', stop);
      runs.delete(run);
      if (s.result === result) s.result = undefined;
      await result.rs.close().catch(() => {});
      if (sessions.get(id) === s) touch(id, s);
    }
  }

  async function finish(id: string, op: 'commit' | 'rollback'): Promise<DbStatus> {
    const s = sessions.get(id);
    if (!s) return DISCONNECTED;
    if (s.executing) throw busyError();
    const conn = await s.conn;
    try {
      await conn[op]();
    } catch (err) {
      throw mapError(err, s.creds);
    }
    s.pending = false;
    touch(id, s);
    return statusOf(s);
  }

  return {
    async open(id, creds) {
      return statusOf(await session(id, creds));
    },
    run,
    rows,
    commit: (id) => finish(id, 'commit'),
    rollback: (id) => finish(id, 'rollback'),
    async close(id) {
      const s = sessions.get(id);
      if (s) await closeSession(id, s);
      return DISCONNECTED;
    },
    status: (id) => statusOf(sessions.get(id)),
    async closeAll() {
      await Promise.all([...sessions].map(([id, s]) => closeSession(id, s)));
    },
  };
}

async function defaultConnect(c: DbCredentials): Promise<DbConnection> {
  return oracledb.getConnection({ connectString: c.connectString, user: c.user, password: c.password, connectTimeout: 15 });
}

function fingerprintOf(c: DbCredentials): string {
  return createHash('sha256').update(`${c.connectString}|${c.user}|${c.password}`).digest('hex');
}

const PLSQL = /^(?:BEGIN|DECLARE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b)/i;

/** Leading whitespace and comments removed, for keyword checks. */
function head(sql: string): string {
  let s = sql.trimStart();
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      s = nl < 0 ? '' : s.slice(nl + 1).trimStart();
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end < 0 ? '' : s.slice(end + 2).trimStart();
    } else return s;
  }
}

/**
 * The statement as Oracle takes it: without a trailing `/` line (SQL*Plus' run marker) and,
 * unless it is PL/SQL, without one trailing `;`. Empty when nothing is left.
 */
export function prepareSql(sql: string): string {
  let s = sql.trim().replace(/(?:^|\n)[ \t]*\/[ \t]*$/, '').trimEnd();
  if (!PLSQL.test(head(s)) && s.endsWith(';')) s = s.slice(0, -1).trimEnd();
  return head(s) ? s : '';
}

export type StatementKind = 'query' | 'dml' | 'ddl' | 'end' | 'other';

/**
 * `ddl` statements (and `COMMIT`/`ROLLBACK`) end the transaction; `dml`, PL/SQL blocks and
 * anything unknown may leave changes pending. Creating a procedure is DDL: Oracle commits it.
 */
export function statementKind(sql: string): StatementKind {
  const word = /^[A-Za-z]+/.exec(head(sql))?.[0]?.toUpperCase() ?? '';
  if (word === 'SELECT' || word === 'WITH') return 'query';
  if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(word)) return 'dml';
  if (['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE', 'RENAME', 'COMMENT', 'AUDIT', 'NOAUDIT', 'PURGE', 'FLASHBACK', 'ANALYZE'].includes(word)) return 'ddl';
  if (word === 'COMMIT' || (word === 'ROLLBACK' && !/^ROLLBACK\s+(?:WORK\s+)?TO\b/i.test(head(sql)))) return 'end';
  return 'other';
}

export function columnType(dbTypeName: string | undefined): DbColumnType {
  switch (dbTypeName) {
    case 'DB_TYPE_NUMBER':
    case 'DB_TYPE_BINARY_FLOAT':
    case 'DB_TYPE_BINARY_DOUBLE':
    case 'DB_TYPE_BINARY_INTEGER':
      return 'number';
    case 'DB_TYPE_DATE':
    case 'DB_TYPE_TIMESTAMP':
    case 'DB_TYPE_TIMESTAMP_TZ':
    case 'DB_TYPE_TIMESTAMP_LTZ':
      return 'date';
    case 'DB_TYPE_RAW':
    case 'DB_TYPE_LONG_RAW':
    case 'DB_TYPE_BLOB':
      return 'binary';
    default:
      return 'text';
  }
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** A DATE/TIMESTAMP without zone, as written in the database (the driver reads it as local time). */
function localIso(d: Date): string {
  const ms = d.getMilliseconds();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${ms ? `.${pad(ms, 3)}` : ''}`;
}

const binary = (v: Uint8Array | null) => (v == null ? null : `<binary ${v.length} bytes>`);

/** NUMBER as string (keeps precision), CLOB as string, dates as ISO text, binary as a size note. */
export function fetchTypeHandler(meta: FetchMetadata): FetchTypeResult | undefined {
  switch (meta.dbType.name) {
    case 'DB_TYPE_NUMBER':
    case 'DB_TYPE_CLOB':
    case 'DB_TYPE_NCLOB':
      return { type: oracledb.STRING };
    case 'DB_TYPE_DATE':
    case 'DB_TYPE_TIMESTAMP':
      return { converter: (v: Date | null) => (v == null ? null : localIso(v)) };
    case 'DB_TYPE_TIMESTAMP_TZ':
    case 'DB_TYPE_TIMESTAMP_LTZ':
      return { converter: (v: Date | null) => (v == null ? null : v.toISOString()) };
    case 'DB_TYPE_BLOB':
      return { type: oracledb.BUFFER, converter: binary };
    case 'DB_TYPE_RAW':
    case 'DB_TYPE_LONG_RAW':
      return { converter: binary };
    case 'DB_TYPE_JSON':
      return { converter: (v: unknown) => (v == null ? null : JSON.stringify(v)) };
    default:
      return undefined;
  }
}

const LOGIN = /ORA-01017/;
const UNREACHABLE = /ORA-12514|ORA-12505|ORA-12541|ORA-12170|NJS-503|NJS-500|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/;

/** The host of a connect string (`host:port/service`, `[v6]:port/service` or a descriptor). */
export function hostOf(connectString: string): string {
  return /\(HOST=([^)]+)\)/i.exec(connectString)?.[1] ?? /^\[([^\]]+)\]/.exec(connectString)?.[1]
    ?? /^[^:/]*/.exec(connectString)![0];
}

/** Driver error → AppError; the password is replaced by `***` in every text. */
export function mapError(err: unknown, creds: DbCredentials): AppError {
  if (err instanceof AppError) return err;
  const scrub = (text: string) => (creds.password ? text.split(creds.password).join('***') : text);
  const e = err as { message?: unknown; code?: unknown };
  const raw = scrub(`${typeof e?.code === 'string' ? `${e.code} ` : ''}${String(e?.message ?? err)}`);
  const message = scrub(String(e?.message ?? err));
  if (LOGIN.test(raw)) return new AppError('invalid', 'dbLogin', 'Login failed: wrong user or password.', { detail: message });
  if (UNREACHABLE.test(raw)) {
    const host = scrub(hostOf(creds.connectString));
    return new AppError('invalid', 'dbUnreachable', `The database at ${host} can't be reached.`, { detail: message, params: { host } });
  }
  const first = message.split('\n')[0]!.trim() || 'Database error.';
  return new AppError('invalid', 'dbError', first, { detail: message, params: { message: first } });
}
