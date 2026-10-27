/// <reference path="./oracledb.d.ts" />
import { createHash, randomUUID } from 'node:crypto';
import oracledb, { type FetchMetadata, type FetchTypeResult } from 'oracledb';
import { AppError, type Emit, invalid, notFound } from '@kedalion/server-core';

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
    rows?: unknown[][];
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
  /** A TIMESTAMP column (also reported as type `date`). */
  timestamp?: boolean;
}

export type DbRunResult =
  | { kind: 'rows'; run: string; columns: DbColumn[] }
  | { kind: 'done'; rowsAffected?: number };

export interface DbRunOptions {
  /** Most rows this query streams (1 to the sessions' `maxRows`); then `{ $truncated: true }` ends it. */
  maxRows?: number;
}

export interface DbSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DbSchemaTable {
  name: string;
  kind: 'table' | 'view';
  columns: DbSchemaColumn[];
}

export interface DbSchema {
  owner: string;
  owners: string[];
  tables: DbSchemaTable[];
  /** The column limit cut the list short. */
  truncated: boolean;
}

/** One step of an EXPLAIN PLAN, as PLAN_TABLE holds it. */
export interface DbPlanRow {
  id: number;
  parentId: number | null;
  depth: number;
  operation: string;
  options: string | null;
  objectOwner: string | null;
  objectName: string | null;
  cost: number | null;
  cardinality: number | null;
  bytes: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
}

export interface DbTableIndex {
  name: string;
  unique: boolean;
  /** In index order; an expression index shows its system column name. */
  columns: string[];
}

export interface DbTableConstraint {
  name: string;
  /** P primary key, U unique, R foreign key, C check. */
  type: 'P' | 'U' | 'R' | 'C';
  columns: string[];
  /** The condition of a check constraint. */
  condition?: string;
  /** For a foreign key: the constraint it references. */
  references?: { owner: string; table: string; constraint: string; columns: string[] };
}

export interface DbTableDetails {
  owner: string;
  name: string;
  indexes: DbTableIndex[];
  /** Ordered P, U, R, C, then by name; system NOT NULL checks left out. */
  constraints: DbTableConstraint[];
  /** DBMS_METADATA.GET_DDL output; null when the user may not read it. */
  ddl: string | null;
}

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
  /** Rows per round trip (and per `getRows`) when streaming a query's rows. */
  fetchBatch?: number;
}

export interface DbSessions {
  /** Connects, runs `select 1 from dual` and disconnects; no session is kept. */
  test(creds: DbCredentials): Promise<void>;
  /** Opens the session of connection record `id` (or reuses it) and reports its status. */
  open(id: string, creds: DbCredentials): Promise<DbStatus>;
  run(id: string, creds: DbCredentials, sql: string, opts?: DbRunOptions): Promise<DbRunResult>;
  /** Tables, views and columns of `owner` (default: the session's schema) and the owners to choose from. */
  schema(id: string, creds: DbCredentials, owner?: string): Promise<DbSchema>;
  /**
   * The execution plan of `sql` (not run), ordered by id. Its PLAN_TABLE rows are deleted again in
   * the same transaction; nothing is committed or rolled back and `pending` is left as it was.
   */
  explain(id: string, creds: DbCredentials, sql: string): Promise<DbPlanRow[]>;
  /** Indexes, constraints and DDL of table `owner.name` (owner default: the session's schema); dictionary reads only. */
  table(id: string, creds: DbCredentials, owner: string, name: string): Promise<DbTableDetails>;
  /** Streams the rows of a `run` result, then closes its result set. */
  rows(run: string, emit: Emit, signal: AbortSignal): Promise<void>;
  /** Breaks the statement now executing and closes a result set whose rows are not being streamed. */
  cancel(id: string): Promise<DbStatus>;
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
  maxRows: number;
}

interface Session {
  fingerprint: string;
  creds: DbCredentials;
  conn: Promise<DbConnection>;
  connected: boolean;
  pending: boolean;
  executing: boolean;
  /** Settles when the statement now executing ends. */
  idle: Promise<void>;
  result?: OpenResult;
  timer?: ReturnType<typeof setTimeout>;
}

const SCHEMA_MAX_COLUMNS = 200_000;
const SCHEMA_MAX_OWNERS = 5000;
/**
 * Rows per round trip for the schema's columns. The driver's default of 100 made a 29k-column
 * schema take 12 s over a 40 ms link (290 round trips); 10 000 takes it under 1 s.
 */
const SCHEMA_FETCH_SIZE = 10_000;

const DISCONNECTED: DbStatus = { connected: false, pending: false, busy: false };

/** Statements on one session wait for the one still executing; an open result set makes `run` fail with this. */
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
  const fetchBatch = opts.fetchBatch ?? 2000;
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

  /** Marks `s` executing until the returned function is called. */
  function startExecuting(s: Session): () => void {
    let end!: () => void;
    s.idle = new Promise((resolve) => { end = resolve; });
    s.executing = true;
    return () => {
      s.executing = false;
      end();
    };
  }

  /** Closes the result set of `s` when its rows are not being streamed. */
  async function dropResult(s: Session): Promise<void> {
    const result = s.result;
    if (!result || result.streaming) return;
    s.result = undefined;
    runs.delete(result.run);
    await result.rs.close().catch(() => {});
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
        idle: Promise.resolve(),
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

  async function run(id: string, creds: DbCredentials, sql: string, runOpts: DbRunOptions = {}): Promise<DbRunResult> {
    const statement = prepareSql(sql);
    if (!statement) throw invalid('badRequest', 'Invalid request.');
    const s = await session(id, creds);
    while (s.executing) await s.idle;
    if (s.result?.streaming) throw busyError();
    // A result nobody fetched (an earlier statement of "Run all", a timed-out query) is dropped.
    await dropResult(s);
    while (s.executing) await s.idle;
    if (s.result) throw busyError();
    const done = startExecuting(s);
    try {
      const conn = await s.conn;
      const kind = statementKind(statement);
      if (kind === 'query') {
        const r = await conn.execute(statement, [], {
          autoCommit: false,
          resultSet: true,
          // The driver's default is 100 rows per round trip, slow over a VPN (see SCHEMA_FETCH_SIZE).
          fetchArraySize: fetchBatch,
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          fetchTypeHandler,
        });
        const columns = (r.metaData ?? []).map((m) => ({ name: m.name, type: columnType(m.dbType?.name), ...(m.dbType?.name?.startsWith('DB_TYPE_TIMESTAMP') ? { timestamp: true } : {}) }));
        if (!r.resultSet) return { kind: 'done' };
        const result = { run: randomUUID(), rs: r.resultSet, streaming: false, maxRows: Math.min(Math.max(runOpts.maxRows ?? maxRows, 1), maxRows) };
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
      done();
      touch(id, s);
    }
  }

  async function schema(id: string, creds: DbCredentials, owner?: string): Promise<DbSchema> {
    const s = await session(id, creds);
    // An open result set doesn't block reading the dictionary.
    while (s.executing) await s.idle;
    const done = startExecuting(s);
    try {
      const conn = await s.conn;
      const options = { autoCommit: false, outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: SCHEMA_MAX_COLUMNS + 1, fetchArraySize: SCHEMA_FETCH_SIZE };
      let name = owner;
      if (!name) {
        const current = await conn.execute("select sys_context('USERENV', 'CURRENT_SCHEMA') from dual", [], options);
        name = String(current.rows?.[0]?.[0] ?? creds.user.toUpperCase());
      }
      const owners = await conn.execute('select username from all_users order by username', [], { ...options, maxRows: SCHEMA_MAX_OWNERS });
      const found = await conn.execute(
        `select c.table_name, o.object_type, c.column_name, c.data_type, c.nullable
           from all_tab_columns c
           join all_objects o on o.owner = c.owner and o.object_name = c.table_name and o.object_type in ('TABLE', 'VIEW')
          where c.owner = :owner and c.table_name not like 'BIN$%'
          order by c.table_name, c.column_id`,
        [name],
        options,
      );
      const rows = found.rows ?? [];
      const tables: DbSchemaTable[] = [];
      for (const [table, kind, column, type, nullable] of rows.slice(0, SCHEMA_MAX_COLUMNS) as string[][]) {
        let t = tables[tables.length - 1];
        if (t?.name !== table) {
          t = { name: table!, kind: kind === 'VIEW' ? 'view' : 'table', columns: [] };
          tables.push(t);
        }
        t.columns.push({ name: column!, type: type!, nullable: nullable === 'Y' });
      }
      return {
        owner: name,
        owners: (owners.rows ?? []).map((r) => String(r[0])),
        tables,
        truncated: rows.length > SCHEMA_MAX_COLUMNS,
      };
    } catch (err) {
      throw mapError(err, s.creds);
    } finally {
      done();
      touch(id, s);
    }
  }

  // EXPLAIN PLAN is DML on PLAN_TABLE (a session-private temporary table), not DDL: it commits
  // nothing, and deleting its rows in the same transaction leaves the user's pending work as it was.
  async function explain(id: string, creds: DbCredentials, sql: string): Promise<DbPlanRow[]> {
    const statement = prepareSql(sql);
    if (!statement) throw invalid('badRequest', 'Invalid request.');
    const s = await session(id, creds);
    // Like `schema`, an open result set doesn't block it.
    while (s.executing) await s.idle;
    const done = startExecuting(s);
    try {
      const conn = await s.conn;
      // STATEMENT_ID is VARCHAR2(30) and can't be bound; this one is hex only.
      const sid = `db${randomUUID().replace(/-/g, '').slice(0, 28)}`;
      await conn.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${sid}' FOR ${statement}`, [], { autoCommit: false });
      try {
        const r = await conn.execute(
          `select id, parent_id, depth, operation, options, object_owner, object_name, cost, cardinality, bytes,
                  access_predicates, filter_predicates
             from plan_table where statement_id = :sid order by id`,
          [sid],
          { autoCommit: false, outFormat: oracledb.OUT_FORMAT_ARRAY },
        );
        return (r.rows ?? []).map((row) => {
          const [id, parentId, depth, operation, options, objectOwner, objectName, cost, cardinality, bytes, access, filter] = row;
          const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
          const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
          return {
            id: Number(id),
            parentId: num(parentId),
            depth: Number(depth ?? 0),
            operation: String(operation ?? ''),
            options: str(options),
            objectOwner: str(objectOwner),
            objectName: str(objectName),
            cost: num(cost),
            cardinality: num(cardinality),
            bytes: num(bytes),
            accessPredicates: str(access),
            filterPredicates: str(filter),
          };
        });
      } finally {
        await conn.execute('delete from plan_table where statement_id = :sid', [sid], { autoCommit: false }).catch(() => {});
      }
    } catch (err) {
      throw mapError(err, s.creds);
    } finally {
      done();
      touch(id, s);
    }
  }

  // Only dictionary selects and DBMS_METADATA (a function in a select): no DML, so the transaction is untouched.
  async function table(id: string, creds: DbCredentials, owner: string, name: string): Promise<DbTableDetails> {
    if (!name) throw invalid('badRequest', 'Invalid request.');
    const s = await session(id, creds);
    while (s.executing) await s.idle;
    const done = startExecuting(s);
    try {
      const conn = await s.conn;
      const options = { autoCommit: false, outFormat: oracledb.OUT_FORMAT_ARRAY };
      let tableOwner = owner;
      if (!tableOwner) {
        const current = await conn.execute("select sys_context('USERENV', 'CURRENT_SCHEMA') from dual", [], options);
        tableOwner = String(current.rows?.[0]?.[0] ?? creds.user.toUpperCase());
      }
      const binds = [tableOwner, name];
      const exists = await conn.execute('select 1 from all_tables where owner = :owner and table_name = :name', binds, options);
      if (!exists.rows?.length) throw notFound('dbTable', 'This table does not exist or is not visible.');

      const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
      const ix = await conn.execute(
        `select i.index_name, i.uniqueness, c.column_name
           from all_indexes i
           join all_ind_columns c on c.index_owner = i.owner and c.index_name = i.index_name
          where i.table_owner = :owner and i.table_name = :name
          order by i.index_name, c.column_position`,
        binds,
        options,
      );
      const indexes: DbTableIndex[] = [];
      for (const [index, uniqueness, column] of ix.rows ?? []) {
        let last = indexes[indexes.length - 1];
        if (last?.name !== str(index)) {
          last = { name: str(index), unique: uniqueness === 'UNIQUE', columns: [] };
          indexes.push(last);
        }
        last.columns.push(str(column));
      }

      const cons = await conn.execute(
        `select c.constraint_name, c.constraint_type, c.generated, c.search_condition, c.r_owner, c.r_constraint_name,
                (select r.table_name from all_constraints r where r.owner = c.r_owner and r.constraint_name = c.r_constraint_name)
           from all_constraints c
          where c.owner = :owner and c.table_name = :name and c.constraint_type in ('P', 'U', 'R', 'C')`,
        binds,
        options,
      );
      const cols = await conn.execute(
        `select constraint_name, column_name from all_cons_columns
          where owner = :owner and table_name = :name order by constraint_name, position`,
        binds,
        options,
      );
      const refCols = await conn.execute(
        `select cc.owner, cc.constraint_name, cc.column_name
           from all_constraints c
           join all_cons_columns cc on cc.owner = c.r_owner and cc.constraint_name = c.r_constraint_name
          where c.owner = :owner and c.table_name = :name and c.constraint_type = 'R'
          order by cc.owner, cc.constraint_name, cc.position`,
        binds,
        options,
      );
      const group = (rows: unknown[][] | undefined, key: (r: unknown[]) => string, value: (r: unknown[]) => string) => {
        const m = new Map<string, string[]>();
        for (const r of rows ?? []) {
          const k = key(r);
          const list = m.get(k) ?? [];
          if (!m.has(k)) m.set(k, list);
          list.push(value(r));
        }
        return m;
      };
      const columnsOf = group(cols.rows, (r) => str(r[0]), (r) => str(r[1]));
      const refColumnsOf = group(refCols.rows, (r) => `${str(r[0])}.${str(r[1])}`, (r) => str(r[2]));
      const constraints: DbTableConstraint[] = [];
      for (const [cname, type, generated, condition, rOwner, rName, rTable] of cons.rows ?? []) {
        const c: DbTableConstraint = { name: str(cname), type: str(type) as DbTableConstraint['type'], columns: columnsOf.get(str(cname)) ?? [] };
        if (c.type === 'C') {
          c.condition = str(condition);
          if (generated === 'GENERATED NAME' && /^\s*"[^"]+"\s+IS\s+NOT\s+NULL\s*$/i.test(c.condition)) continue;
        }
        if (c.type === 'R') {
          c.references = { owner: str(rOwner), table: str(rTable), constraint: str(rName), columns: refColumnsOf.get(`${str(rOwner)}.${str(rName)}`) ?? [] };
        }
        constraints.push(c);
      }
      const order = 'PURC';
      constraints.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name));

      let ddl: string | null = null;
      try {
        const r = await conn.execute("select dbms_metadata.get_ddl('TABLE', :name, :owner) as ddl from dual", [name, tableOwner], {
          ...options,
          fetchInfo: { DDL: { type: oracledb.STRING } },
        });
        const v = r.rows?.[0]?.[0];
        ddl = v === null || v === undefined ? null : String(v).trim();
      } catch {
        // No privilege to read another schema's metadata: show the rest.
      }
      return { owner: tableOwner, name, indexes, constraints, ddl };
    } catch (err) {
      throw err instanceof AppError ? err : mapError(err, s.creds);
    } finally {
      done();
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
    const limit = result.maxRows;
    const conn = await s.conn;
    const stop = () => { void conn.break().catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });
    try {
      let count = 0;
      while (!signal.aborted) {
        if (count >= limit) {
          const more = await result.rs.getRows(1);
          if (more.length) await emit({ $truncated: true });
          break;
        }
        const batch = await result.rs.getRows(Math.min(fetchBatch, limit - count));
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
    while (s.executing) await s.idle;
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
    async test(creds) {
      let conn: DbConnection | undefined;
      try {
        conn = await connect(creds);
        await conn.execute('select 1 from dual', [], { autoCommit: false });
      } catch (err) {
        throw mapError(err, creds);
      } finally {
        await conn?.close().catch(() => {});
      }
    },
    async open(id, creds) {
      return statusOf(await session(id, creds));
    },
    run,
    schema,
    explain,
    table,
    rows,
    async cancel(id) {
      const s = sessions.get(id);
      if (!s) return DISCONNECTED;
      const conn = await s.conn.catch(() => null);
      if (conn && s.executing) {
        await conn.break().catch(() => {});
        await s.idle;
      }
      await dropResult(s);
      return statusOf(s);
    },
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
const UNREACHABLE = /ORA-12514|ORA-12505|ORA-12541|ORA-12170|NJS-503|NJS-500|NJS-530|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/;

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
