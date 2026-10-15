import { describe, expect, test } from 'bun:test';
import { resolveMarkers, sqlMarkers, sqlParams } from './markers';

const SQL = [
  'SELECT 1 FROM c WHERE 1=1',
  "/*%JS=result=('{1}'!='') %*/AND c.reference IN ({1})",
  "/*%JS=result=('{2}'!='') %*/AND c.contract_id IN ({2})",
  'AND c.x = {1}',
].join('\n');

describe('sqlMarkers', () => {
  test('finds markers with fragment and params', () => {
    const ms = sqlMarkers(SQL);
    expect(ms.length).toBe(2);
    expect(ms[0]!.condition).toBe("result=('{1}'!='')");
    expect(ms[0]!.params).toEqual([1]);
    expect(SQL.slice(ms[0]!.fragmentFrom, ms[0]!.fragmentTo)).toBe('AND c.reference IN ({1})');
    expect(ms[1]!.fragmentParams).toEqual([2]);
  });

  test('handles empty and unterminated input', () => {
    expect(sqlMarkers('')).toEqual([]);
    expect(sqlMarkers('/*%JS=result=true')).toEqual([]);
  });
});

describe('sqlParams', () => {
  test('counts guarded and unguarded uses', () => {
    const ps = sqlParams(SQL);
    expect(ps.map((p) => p.n)).toEqual([1, 2]);
    expect(ps[0]).toMatchObject({ markers: 1, unguarded: 1, count: 3 });
    expect(ps[1]).toMatchObject({ markers: 1, unguarded: 0 });
    expect(ps[0]!.firstFrom).toBe(SQL.indexOf('{1}'));
  });
});

describe('resolveMarkers', () => {
  const sql = "SELECT 1\n/*%JS=result=('{1}'!='') %*/ AND a IN ({1})\nAND b = {2}";

  test('keeps the fragment when the condition holds', () => {
    expect(resolveMarkers(sql, { 1: "'x','y'", 2: '5' }).sql).toBe("SELECT 1\n AND a IN ('x','y')\nAND b = 5");
  });

  test('drops the fragment, keeps the newline, missing value is empty', () => {
    const r = resolveMarkers(sql, {});
    expect(r.sql).toBe('SELECT 1\n\nAND b = ');
    expect(r.sql.split('\n').length).toBe(sql.split('\n').length);
  });

  test('supports == and escapes quotes in values', () => {
    const t = "/*%JS=result='{1}'=='a\\'b' %*/ X";
    expect(resolveMarkers(t, { 1: "a'b" }).sql).toBe(' X');
    expect(resolveMarkers(t, { 1: 'c' }).sql).toBe('');
  });

  test('falls back to JS evaluation', () => {
    expect(resolveMarkers("/*%JS=result='{1}'.length>1 %*/ X", { 1: 'ab' }).sql).toBe(' X');
    expect(resolveMarkers("/*%JS=result='{1}'.length>1 %*/ X", { 1: 'a' }).sql).toBe('');
  });

  test('reports a failing condition', () => {
    expect(resolveMarkers('/*%JS=result=( %*/ X', {}).error).toContain('result=(');
  });
});
