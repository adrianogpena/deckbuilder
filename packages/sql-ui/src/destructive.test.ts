import { describe, expect, test } from 'bun:test';
import { isDestructive } from './destructive';

describe('isDestructive', () => {
  test('flags DROP and TRUNCATE', () => {
    expect(isDestructive('DROP TABLE t')).toBe(true);
    expect(isDestructive('  truncate table t;')).toBe(true);
  });

  test('flags DELETE and UPDATE without WHERE', () => {
    expect(isDestructive('delete from t')).toBe(true);
    expect(isDestructive('UPDATE t SET a = 1;')).toBe(true);
  });

  test('allows DELETE and UPDATE with WHERE', () => {
    expect(isDestructive('DELETE FROM t WHERE id = 1')).toBe(false);
    expect(isDestructive('update t set a = 1 where b = 2')).toBe(false);
  });

  test('allows other statements', () => {
    expect(isDestructive('SELECT * FROM t')).toBe(false);
    expect(isDestructive('INSERT INTO t VALUES (1)')).toBe(false);
  });

  test('ignores comments and string contents', () => {
    expect(isDestructive('-- drop table t\nSELECT 1')).toBe(false);
    expect(isDestructive("/* where */ DELETE FROM t")).toBe(true);
    expect(isDestructive("UPDATE t SET a = 'where'")).toBe(true);
    expect(isDestructive("SELECT 'drop table t'")).toBe(false);
  });
});
