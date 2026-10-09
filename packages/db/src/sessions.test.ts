import { describe, expect, test } from 'bun:test';
import oracledb from 'oracledb';
import { AppError } from '@deckbuilder/server-core';
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

  test('DDL clears pending', async () => {
    const { sessions } = setup();
    await sessions.run('a', CREDS, 'delete from t');
    await sessions.run('a', CREDS, 'create table x (a number)');
    expect(sessions.status('a').pending).toBe(false);
  });

  test('busy while running or a result set is open', async () => {
    const { sessions, conns } = setup();
    await sessions.open('a', CREDS);
    conns[0]!.hold();
    const first = sessions.run('a', CREDS, 'delete from t');
    await Bun.sleep(1);
    expect(sessions.status('a').busy).toBe(true);
    expect(await codeOf(sessions.run('a', CREDS, 'select 1 from dual'))).toBe('dbBusy');
    expect(await codeOf(sessions.commit('a'))).toBe('dbBusy');
    conns[0]!.release();
    await first;
    await sessions.run('a', CREDS, 'select 1 from dual');
    expect(await codeOf(sessions.run('a', CREDS, 'select 2 from dual'))).toBe('dbBusy');
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
