import { afterAll, expect, test } from 'bun:test';
import type { AppError } from '@deckbuilder/server-core';
import { parseOracleUrl } from './oracle-url.ts';
import { dbSessions } from './sessions.ts';

const LIVE = process.env.DECKBUILDER_DB_LIVE === '1';
const USER = process.env.DECKBUILDER_DB_USER;
const PASSWORD = process.env.DECKBUILDER_DB_PASSWORD;
const { connectString } = parseOracleUrl(process.env.DECKBUILDER_DB_URL ?? 'oracle:thin:@milesora4next4:1521/MILESNEXT');

const sessions = dbSessions();
afterAll(() => sessions.closeAll());

test.skipIf(!LIVE)('a fake login is refused', async () => {
  const password = 'not-the-password-42';
  try {
    await sessions.open('fake', { connectString, user: 'deckbuilder_nobody', password });
    throw new Error('connected');
  } catch (err) {
    const e = err as AppError;
    expect(e.code).toBe('dbLogin');
    expect(JSON.stringify(e.toJSON())).not.toContain(password);
  }
}, 30_000);

test.skipIf(!LIVE || !USER || !PASSWORD)('select streams a row and a block rolls back', async () => {
  const creds = { connectString, user: USER!, password: PASSWORD! };
  const r = await sessions.run('live', creds, 'select sysdate from dual;');
  if (r.kind !== 'rows') throw new Error('no rows');
  expect(r.columns).toEqual([{ name: 'SYSDATE', type: 'date' }]);
  const rows: unknown[] = [];
  await sessions.rows(r.run, async (row) => { rows.push(row); }, new AbortController().signal);
  expect(rows).toHaveLength(1);
  expect((rows[0] as string[])[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);

  // A block, not an insert: the test must not create objects in a shared schema.
  expect(await sessions.run('live', creds, 'begin null; end;\n/')).toMatchObject({ kind: 'done' });
  expect(sessions.status('live').pending).toBe(true);
  expect((await sessions.rollback('live')).pending).toBe(false);
}, 60_000);

test.skipIf(!LIVE || !USER || !PASSWORD)('explain returns the plan and leaves pending as it was', async () => {
  const creds = { connectString, user: USER!, password: PASSWORD! };
  const plan = await sessions.explain('live', creds, 'select * from dual;');
  expect(plan[0]).toMatchObject({ id: 0, parentId: null, operation: 'SELECT STATEMENT' });
  expect(plan.some((r) => r.objectName === 'DUAL')).toBe(true);
  expect(sessions.status('live').pending).toBe(false);
  await sessions.run('live', creds, 'begin null; end;');
  await sessions.explain('live', creds, 'select * from dual');
  expect(sessions.status('live').pending).toBe(true);
  await sessions.rollback('live');
}, 60_000);

test.skipIf(!LIVE || !USER || !PASSWORD)('table returns details and DDL of an own table and leaves pending as it was', async () => {
  const creds = { connectString, user: USER!, password: PASSWORD! };
  const schema = await sessions.schema('live', creds);
  const own = schema.tables.find((t) => t.kind === 'table');
  if (!own) return;
  await sessions.run('live', creds, 'begin null; end;');
  const details = await sessions.table('live', creds, '', own.name);
  expect(details).toMatchObject({ owner: schema.owner, name: own.name });
  expect(details.ddl).toContain('CREATE TABLE');
  expect(details.constraints.every((c) => ['P', 'U', 'R', 'C'].includes(c.type))).toBe(true);
  expect(sessions.status('live').pending).toBe(true);
  await sessions.rollback('live');
}, 60_000);
