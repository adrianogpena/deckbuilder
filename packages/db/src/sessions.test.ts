import { describe, expect, test } from 'bun:test';
import oracledb from 'oracledb';
import { AppError } from '@kedalion/server-core';
import {
  type DbConnection,
  type DbCredentials,
  type DbResultSet,
  dbSessions,
  fetchTypeHandler,
  hostOf,
  mapError,
  prepareSql,
  statementKind,
} from './sessions.ts';

const CREDS: DbCredentials = { connectString: 'dbhost:1521/SVC', user: 'scott', password: 's3cret!' };

function fakeResultSet(total: number) {
  let next = 0;
  const rs = {
    closed: false,
    async getRows(n: number) {
      const rows: unknown[][] = [];
      while (rows.length < n && next < total) rows.push([next++, `r${next}`]);
      return rows;
    },
    async close() {
      rs.closed = true;
    },
  };
  return rs;
}

function fakeConnection(opts: { rows?: number; fail?: Error } = {}) {
  const log: string[] = [];
  let lastRs: ReturnType<typeof fakeResultSet> | undefined;
  let release: (() => void) | undefined;
  const conn: DbConnection & { log: string[]; lastRs: () => typeof lastRs; hold: () => void; release: () => void } = {
    log,
    lastRs: () => lastRs,
    hold() {
      const gate = new Promise<void>((r) => { release = r; });
      (conn as any).gate = gate;
    },
    release: () => release?.(),
    async execute(sql, _binds, options) {
      log.push(`execute ${sql}`);
      await (conn as any).gate;
      if (opts.fail) throw opts.fail;
      if (options.resultSet) {
        lastRs = fakeResultSet(opts.rows ?? 3);
        return {
          metaData: [{ name: 'ID', dbType: { name: 'DB_TYPE_NUMBER' } }, { name: 'NAME', dbType: { name: 'DB_TYPE_VARCHAR' } }],
          resultSet: lastRs as DbResultSet,
        };
      }
      return { rowsAffected: 2 };
    },
    async commit() { log.push('commit'); },
    async rollback() { log.push('rollback'); },
    async break() { log.push('break'); },
    async close() { log.push('close'); },
  };
  return conn;
}

function setup(opts: { rows?: number; maxRows?: number; idleMs?: number; fail?: Error } = {}) {
  const conns: ReturnType<typeof fakeConnection>[] = [];
  const sessions = dbSessions({
    connect: async () => {
      const c = fakeConnection(opts);
      conns.push(c);
      return c;
    },
    maxRows: opts.maxRows,
    idleMs: opts.idleMs,
    fetchBatch: 2,
  });
  return { sessions, conns };
}

async function collect(sessions: ReturnType<typeof dbSessions>, run: string, signal = new AbortController().signal) {
  const items: unknown[] = [];
  await sessions.rows(run, async (item) => { items.push(item); }, signal);
  return items;
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return (err as AppError).code;
  }
  return null;
}

describe('dbSessions', () => {
  test('query returns columns and streams rows', async () => {
    const { sessions, conns } = setup({ rows: 3 });
    const r = await sessions.run('a', CREDS, 'select * from t;');
    expect(r).toMatchObject({ kind: 'rows', columns: [{ name: 'ID', type: 'number' }, { name: 'NAME', type: 'text' }] });
    expect(conns[0]!.log).toEqual(['execute select * from t']);
    expect(sessions.status('a')).toEqual({ connected: true, pending: false, busy: true });
    const items = await collect(sessions, (r as { run: string }).run);
    expect(items).toEqual([[0, 'r1'], [1, 'r2'], [2, 'r3']]);
    expect(conns[0]!.lastRs()!.closed).toBe(true);
    expect(sessions.status('a').busy).toBe(false);
  });

  test('truncates at maxRows', async () => {
    const { sessions } = setup({ rows: 10, maxRows: 5 });
    const r = await sessions.run('a', CREDS, 'select 1 from dual') as { run: string };
    const items = await collect(sessions, r.run);
    expect(items).toHaveLength(6);
    expect(items[5]).toEqual({ $truncated: true });
  });

  test('exactly maxRows is not truncated', async () => {
    const { sessions } = setup({ rows: 4, maxRows: 4 });
    const r = await sessions.run('a', CREDS, 'select 1 from dual') as { run: string };
    expect(await collect(sessions, r.run)).toHaveLength(4);
  });

  test('a run limit lowers the session limit but never raises it', async () => {
    const { sessions } = setup({ rows: 10, maxRows: 5 });
    const low = await sessions.run('a', CREDS, 'select 1 from dual', { maxRows: 2 }) as { run: string };
    expect(await collect(sessions, low.run)).toEqual([[0, 'r1'], [1, 'r2'], { $truncated: true }]);
    const high = await sessions.run('a', CREDS, 'select 1 from dual', { maxRows: 50 }) as { run: string };
    expect(await collect(sessions, high.run)).toHaveLength(6);
  });

  test('schema groups columns by table and lists owners', async () => {
    const queries: string[] = [];
    const sessions = dbSessions({
      connect: async () => ({
        ...fakeConnection(),
        async execute(sql: string) {
          queries.push(sql);
          if (sql.includes('CURRENT_SCHEMA')) return { rows: [['MILES']] };
          if (sql.includes('all_users')) return { rows: [['MILES'], ['SCOTT']] };
          return { rows: [['T1', 'TABLE', 'ID', 'NUMBER', 'N'], ['T1', 'TABLE', 'NAME', 'VARCHAR2', 'Y'], ['V1', 'VIEW', 'X', 'DATE', 'Y']] };
        },
      }),
    });
    const schema = await sessions.schema('a', CREDS);
    expect(schema).toEqual({
      owner: 'MILES',
      owners: ['MILES', 'SCOTT'],
      tables: [
        { name: 'T1', kind: 'table', columns: [{ name: 'ID', type: 'NUMBER', nullable: false }, { name: 'NAME', type: 'VARCHAR2', nullable: true }] },
        { name: 'V1', kind: 'view', columns: [{ name: 'X', type: 'DATE', nullable: true }] },
      ],
      truncated: false,
    });
    expect(sessions.status('a').pending).toBe(false);
  });

  test('a result streams once', async () => {
    const { sessions } = setup();
    const r = await sessions.run('a', CREDS, 'select 1 from dual') as { run: string };
    await collect(sessions, r.run);
    expect(await codeOf(collect(sessions, r.run))).toBe('dbResultGone');
  });

  test('DML sets pending, commit and rollback clear it', async () => {
    const { sessions, conns } = setup();
    expect(await sessions.run('a', CREDS, 'insert into t values (1)')).toEqual({ kind: 'done', rowsAffected: 2 });
    expect(sessions.status('a').pending).toBe(true);
    expect((await sessions.commit('a')).pending).toBe(false);
    await sessions.run('a', CREDS, 'update t set x = 1');
    expect((await sessions.rollback('a')).pending).toBe(false);
    expect(conns[0]!.log).toContain('commit');
    expect(conns[0]!.log).toContain('rollback');
  });

  test('explain keeps pending and neither commits nor rolls back', async () => {
    const { sessions, conns } = setup();
    await sessions.run('a', CREDS, 'update t set x = 1');
    expect(await sessions.explain('a', CREDS, 'update t set x = 2;')).toEqual([]);
    expect(sessions.status('a').pending).toBe(true);
    const log = conns[0]!.log.slice(1);
    expect(log[0]).toMatch(/^execute EXPLAIN PLAN SET STATEMENT_ID = 'db[0-9a-f]{28}' FOR update t set x = 2$/);
    expect(log.at(-1)).toBe('execute delete from plan_table where statement_id = :sid');
    expect(log).not.toContain('commit');
    expect(log).not.toContain('rollback');
  });

  test('table groups indexes and constraints, fetches DDL as string and keeps pending', async () => {
    const queries: { sql: string; binds: unknown[]; options: Record<string, unknown> }[] = [];
    const base = fakeConnection();
    const sessions = dbSessions({
      connect: async () => ({
        ...base,
        async execute(sql: string, binds: unknown[], options: Record<string, unknown>) {
          queries.push({ sql, binds, options });
          if (sql.includes('CURRENT_SCHEMA')) return { rows: [['MILES']] };
          if (sql.includes('from all_tables')) return { rows: [[1]] };
          if (sql.includes('all_ind_columns')) return { rows: [['T_PK', 'UNIQUE', 'ID'], ['T_IX', 'NONUNIQUE', 'A'], ['T_IX', 'NONUNIQUE', 'B']] };
          if (sql.includes('r_constraint_name,')) {
            return {
              rows: [
                ['T_CK', 'C', 'USER NAME', 'A > 0', null, null, null],
                ['SYS_C001', 'C', 'GENERATED NAME', '"ID" IS NOT NULL', null, null, null],
                ['T_FK', 'R', 'USER NAME', null, 'OTHER', 'P_PK', 'P'],
                ['T_PK', 'P', 'USER NAME', null, null, null, null],
              ],
            };
          }
          if (sql.includes('cc.owner')) return { rows: [['OTHER', 'P_PK', 'PID']] };
          if (sql.includes('all_cons_columns')) return { rows: [['SYS_C001', 'ID'], ['T_CK', 'A'], ['T_FK', 'B'], ['T_PK', 'ID']] };
          if (sql.includes('dbms_metadata')) return { rows: [['\n  CREATE TABLE "MILES"."T" ("ID" NUMBER)']] };
          return { rowsAffected: 1 };
        },
      }),
    });
    await sessions.run('a', CREDS, 'update t set x = 1');
    expect(await sessions.table('a', CREDS, '', 'T')).toEqual({
      owner: 'MILES',
      name: 'T',
      indexes: [
        { name: 'T_PK', unique: true, columns: ['ID'] },
        { name: 'T_IX', unique: false, columns: ['A', 'B'] },
      ],
      constraints: [
        { name: 'T_PK', type: 'P', columns: ['ID'] },
        { name: 'T_FK', type: 'R', columns: ['B'], references: { owner: 'OTHER', table: 'P', constraint: 'P_PK', columns: ['PID'] } },
        { name: 'T_CK', type: 'C', columns: ['A'], condition: 'A > 0' },
      ],
      ddl: 'CREATE TABLE "MILES"."T" ("ID" NUMBER)',
    });
    expect(queries.find((q) => q.sql.includes('all_ind_columns'))!.binds).toEqual(['MILES', 'T']);
    expect(queries.find((q) => q.sql.includes('dbms_metadata'))!.options.fetchInfo).toEqual({ DDL: { type: oracledb.STRING } });
    expect(sessions.status('a').pending).toBe(true);
    expect(base.log).not.toContain('commit');
    expect(base.log).not.toContain('rollback');
  });

  test('table of a missing table is not found', async () => {
    const sessions = dbSessions({ connect: async () => ({ ...fakeConnection(), async execute() { return { rows: [] }; } }) });
    expect(await codeOf(sessions.table('a', CREDS, 'MILES', 'NOPE'))).toBe('dbTable');
  });

  test('DDL clears pending', async () => {
    const { sessions } = setup();
    await sessions.run('a', CREDS, 'delete from t');
    await sessions.run('a', CREDS, 'create table x (a number)');
    expect(sessions.status('a').pending).toBe(false);
  });

  test('statements wait for one still executing; an open result set is busy', async () => {
    const { sessions, conns } = setup();
    await sessions.open('a', CREDS);
    conns[0]!.hold();
    const first = sessions.run('a', CREDS, 'delete from t');
    await Bun.sleep(1);
    expect(sessions.status('a').busy).toBe(true);
    const second = sessions.run('a', CREDS, 'update t set a = 1');
    const commit = sessions.commit('a');
    await Bun.sleep(1);
    expect(conns[0]!.log).toEqual(['execute delete from t']);
    conns[0]!.release();
    await Promise.all([first, second, commit]);
    expect(conns[0]!.log[0]).toBe('execute delete from t');
    expect(conns[0]!.log.slice(1).sort()).toEqual(['commit', 'execute update t set a = 1']);
    await sessions.run('a', CREDS, 'select 1 from dual');
    expect(sessions.status('a').busy).toBe(true);
    expect((await sessions.run('a', CREDS, 'select 2 from dual')).kind).toBe('rows');
  });

  test('schema waits for a statement still executing', async () => {
    const { sessions, conns } = setup();
    await sessions.open('a', CREDS);
    conns[0]!.hold();
    const first = sessions.schema('a', CREDS, 'SCOTT');
    const second = sessions.schema('a', CREDS, 'HR');
    await Bun.sleep(1);
    expect(conns[0]!.log).toHaveLength(1);
    conns[0]!.release();
    expect((await first).owner).toBe('SCOTT');
    expect((await second).owner).toBe('HR');
    expect(sessions.status('a').busy).toBe(false);
  });

  test('test connects, runs a probe and closes without a session', async () => {
    const { sessions, conns } = setup();
    await sessions.test(CREDS);
    expect(conns[0]!.log).toEqual(['execute select 1 from dual', 'close']);
    expect(sessions.status('a').connected).toBe(false);
  });

  test('test maps driver errors and still closes', async () => {
    const { sessions, conns } = setup({ fail: new Error('ORA-01017: invalid credential for s3cret!') });
    expect(await codeOf(sessions.test(CREDS))).toBe('dbLogin');
    expect(conns[0]!.log).toEqual(['execute select 1 from dual', 'close']);
  });

  test('abort breaks and closes the result set', async () => {
    const { sessions, conns } = setup({ rows: 100 });
    const r = await sessions.run('a', CREDS, 'select 1 from dual') as { run: string };
    const ctrl = new AbortController();
    const items: unknown[] = [];
    await sessions.rows(r.run, async (item) => {
      items.push(item);
      if (items.length === 3) ctrl.abort();
    }, ctrl.signal);
    expect(items.length).toBeLessThan(100);
    expect(conns[0]!.log).toContain('break');
    expect(conns[0]!.lastRs()!.closed).toBe(true);
    expect(sessions.status('a').busy).toBe(false);
  });

  test('changed credentials with pending changes are refused', async () => {
    const { sessions, conns } = setup();
    await sessions.run('a', CREDS, 'insert into t values (1)');
    expect(await codeOf(sessions.open('a', { ...CREDS, password: 'other' }))).toBe('dbPendingChanges');
    await sessions.rollback('a');
    await sessions.open('a', { ...CREDS, password: 'other' });
    expect(conns).toHaveLength(2);
    expect(conns[0]!.log.slice(-2)).toEqual(['rollback', 'close']);
  });

  test('close rolls back and closes', async () => {
    const { sessions, conns } = setup();
    await sessions.run('a', CREDS, 'insert into t values (1)');
    expect(await sessions.close('a')).toEqual({ connected: false, pending: false, busy: false });
    expect(conns[0]!.log.slice(-2)).toEqual(['rollback', 'close']);
  });

  test('idle sessions roll back and close', async () => {
    const { sessions, conns } = setup({ idleMs: 20 });
    await sessions.run('a', CREDS, 'insert into t values (1)');
    await Bun.sleep(60);
    expect(sessions.status('a').connected).toBe(false);
    expect(conns[0]!.log.slice(-2)).toEqual(['rollback', 'close']);
  });

  test('driver errors are mapped and scrubbed', async () => {
    const { sessions } = setup({ fail: new Error(`ORA-00942: table or view does not exist near s3cret!\nline 2`) });
    try {
      await sessions.run('a', CREDS, 'select * from nope');
      throw new Error('no error');
    } catch (err) {
      const e = err as AppError;
      expect(e.code).toBe('dbError');
      expect(e.message).toBe('ORA-00942: table or view does not exist near ***');
      expect(JSON.stringify(e.toJSON())).not.toContain('s3cret!');
    }
  });
});

describe('mapError', () => {
  test('login', () => {
    const e = mapError(Object.assign(new Error('ORA-01017: invalid credential or not authorized; logon denied'), { code: 'ORA-01017' }), CREDS);
    expect(e.code).toBe('dbLogin');
  });

  test.each([
    'NJS-503: connection to host dbhost port 1521 could not be established. Error: connect ECONNREFUSED',
    'ORA-12514: Cannot connect to database. Service SVC is not registered',
    'getaddrinfo ENOTFOUND dbhost',
  ])('unreachable: %s', (message) => {
    const e = mapError(new Error(message), CREDS);
    expect(e.code).toBe('dbUnreachable');
    expect(e.opts.params).toEqual({ host: 'dbhost' });
  });

  test('scrubs the password from the login detail', () => {
    const e = mapError(new Error('ORA-01017: logon denied for s3cret!'), CREDS);
    expect(JSON.stringify(e.toJSON())).not.toContain('s3cret!');
  });
});

test('hostOf', () => {
  expect(hostOf('h1:1521/S')).toBe('h1');
  expect(hostOf('[::1]:1521/S')).toBe('::1');
  expect(hostOf('(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h2)(PORT=1521))(CONNECT_DATA=(SID=X)))')).toBe('h2');
});

describe('prepareSql', () => {
  test.each([
    ['select 1 from dual;', 'select 1 from dual'],
    ['select 1 from dual;;', 'select 1 from dual;'],
    ['  update t set a = 1 ;  ', 'update t set a = 1'],
    ['select 1 from dual;\n/', 'select 1 from dual'],
    ['select 10/2 from dual', 'select 10/2 from dual'],
    ['begin\n  null;\nend;\n/\n', 'begin\n  null;\nend;'],
    ['-- note\nDECLARE x number; BEGIN x := 1; END;', '-- note\nDECLARE x number; BEGIN x := 1; END;'],
    ['create or replace procedure p as begin null; end;\r\n/', 'create or replace procedure p as begin null; end;'],
    ['create table t (a number);', 'create table t (a number)'],
    [';', ''],
    ['/', ''],
    ['-- only a comment', ''],
  ])('%j', (sql, expected) => {
    expect(prepareSql(sql)).toBe(expected);
  });
});

test('statementKind', () => {
  expect(statementKind('/* c */ WITH x AS (select 1 from dual) select * from x')).toBe('query');
  expect(statementKind('merge into t using s on (1=1)')).toBe('dml');
  expect(statementKind('truncate table t')).toBe('ddl');
  expect(statementKind('commit')).toBe('end');
  expect(statementKind('rollback to savepoint a')).toBe('other');
  expect(statementKind('begin null; end;')).toBe('other');
});

test('fetchTypeHandler', () => {
  const h = (name: string) => fetchTypeHandler({ name: 'C', dbType: { num: 0, name } });
  expect(h('DB_TYPE_NUMBER')).toEqual({ type: oracledb.STRING });
  expect(h('DB_TYPE_CLOB')).toEqual({ type: oracledb.STRING });
  expect(h('DB_TYPE_VARCHAR')).toBeUndefined();
  expect(h('DB_TYPE_DATE')!.converter!(new Date(2026, 9, 9, 8, 5, 3))).toBe('2026-10-09T08:05:03');
  expect(h('DB_TYPE_TIMESTAMP_TZ')!.converter!(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)))).toBe('2026-01-02T03:04:05.006Z');
  expect(h('DB_TYPE_BLOB')!.type).toBe(oracledb.BUFFER);
  expect(h('DB_TYPE_RAW')!.converter!(new Uint8Array(16))).toBe('<binary 16 bytes>');
  expect(h('DB_TYPE_RAW')!.converter!(null)).toBeNull();
});
