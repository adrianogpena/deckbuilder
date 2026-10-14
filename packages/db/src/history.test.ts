import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqlHistory } from './history.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sql-history-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const entry = (sql: string, connectionId = 'c1') => ({ connectionId, sql, at: Date.now(), ms: 1 });

describe('sqlHistory', () => {
  test('appends newest first and persists', async () => {
    const h = sqlHistory({ dir, max: 10 });
    await h.append(entry('select 1'));
    await h.append(entry('select 2'));
    expect((await h.list()).map((e) => e.sql)).toEqual(['select 2', 'select 1']);
    const again = sqlHistory({ dir, max: 10 });
    expect((await again.list()).map((e) => e.sql)).toEqual(['select 2', 'select 1']);
    expect(await readdir(dir)).toEqual(['sql-history.json']);
  });

  test('caps at max', async () => {
    const h = sqlHistory({ dir, max: 2 });
    for (const n of [1, 2, 3]) await h.append(entry(`select ${n}`));
    expect((await h.list()).map((e) => e.sql)).toEqual(['select 3', 'select 2']);
  });

  test('max 0 records nothing and max can change at runtime', async () => {
    let max = 0;
    const h = sqlHistory({ dir, max: () => max });
    expect(await h.append(entry('select 1'))).toBeNull();
    expect(await h.list()).toEqual([]);
    max = 5;
    await h.append(entry('select 2'));
    h.setMax(0);
    await h.append(entry('select 3'));
    expect((await h.list()).map((e) => e.sql)).toEqual(['select 2']);
  });

  test('filters by text and connection', async () => {
    const h = sqlHistory({ dir, max: 10 });
    await h.append(entry('SELECT * FROM emp', 'a'));
    await h.append(entry('select * from dept', 'b'));
    await h.append(entry('update emp set x = 1', 'b'));
    expect((await h.list({ q: 'emp' })).length).toBe(2);
    expect((await h.list({ connection: 'b' })).length).toBe(2);
    expect((await h.list({ q: 'EMP', connection: 'b' })).map((e) => e.sql)).toEqual(['update emp set x = 1']);
  });

  test('sets rows, deletes and clears', async () => {
    const h = sqlHistory({ dir, max: 10 });
    const a = (await h.append(entry('select 1')))!;
    const b = (await h.append(entry('select 2')))!;
    await h.setRows(a.id, 7);
    expect((await h.list()).find((e) => e.id === a.id)?.rows).toBe(7);
    await h.delete([b.id]);
    expect((await h.list()).map((e) => e.id)).toEqual([a.id]);
    await h.clear();
    expect(await h.list()).toEqual([]);
    expect(JSON.parse(await readFile(join(dir, 'sql-history.json'), 'utf8'))).toEqual([]);
  });

  test('concurrent appends all land', async () => {
    const h = sqlHistory({ dir, max: 100 });
    await Promise.all(Array.from({ length: 20 }, (_, i) => h.append(entry(`select ${i}`))));
    expect((await sqlHistory({ dir, max: 100 }).list()).length).toBe(20);
  });
});
