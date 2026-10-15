import { describe, expect, test } from 'bun:test';
import { sqlLint, type SqlLintCode } from './lint.ts';
import { sqlOutline } from './outline.ts';

const of = (sql: string, code: SqlLintCode) => sqlLint(sql).filter((p) => p.code === code);
const spans = (sql: string, code: SqlLintCode) => of(sql, code).map((p) => sql.slice(p.from, p.to));

describe('sqlLint', () => {
  test('nullCompare', () => {
    expect(spans('select a from t where a = null', 'nullCompare')).toEqual(['a = null']);
    expect(spans('select a from t where null <> t.b and c != NULL', 'nullCompare')).toEqual(['null <> t.b', 'c != NULL']);
    expect(of('select a from t where a = null', 'nullCompare')[0]!.severity).toBe('error');
    expect(of('select a from t where a is null', 'nullCompare')).toEqual([]);
    expect(of("select a from t where a = 'x = null'", 'nullCompare')).toEqual([]);
    expect(of('select a from t -- where a = null', 'nullCompare')).toEqual([]);
    expect(spans('update t set a = null, b = null where c != null', 'nullCompare')).toEqual(['c != null']);
    expect(of('begin if x = null then null; end if; end;', 'nullCompare')).toEqual([]);
  });

  test('notInNullable', () => {
    expect(spans('select a from t where id not in (select x from y)', 'notInNullable')).toEqual(['not in']);
    expect(of('select a from t where id not in (1, 2)', 'notInNullable')).toEqual([]);
    expect(of('select a from t where not exists (select 1 from y where y.x = t.id)', 'notInNullable')).toEqual([]);
  });

  test('leftJoinUndone', () => {
    const sql = "select a.id from a left join b on b.a_id = a.id where a.x = 1 and b.status = 'X'";
    const p = of(sql, 'leftJoinUndone');
    expect(p.map((x) => sql.slice(x.from, x.to))).toEqual(["b.status = 'X'"]);
    expect(p[0]!.params).toEqual({ alias: 'b' });
    expect(p[0]!.step).toBe('');
    expect(of('select 1 from a left join b on b.a_id = a.id where b.x is not null', 'leftJoinUndone')).toHaveLength(1);
    expect(spans('select 1 from a right outer join b on b.a_id = a.id where a.x = 1', 'leftJoinUndone')).toEqual(['a.x = 1']);
    expect(of('select 1 from a left join b on b.a_id = a.id where b.x is null', 'leftJoinUndone')).toEqual([]);
    expect(of("select 1 from a left join b on b.a_id = a.id and b.status = 'X'", 'leftJoinUndone')).toEqual([]);
    expect(of("select 1 from a left join b on b.a_id = a.id where nvl(b.status, 'X') = 'X'", 'leftJoinUndone')).toEqual([]);
    expect(of("select 1 from a left join b on b.a_id = a.id where (b.status = 'X' or b.status is null)", 'leftJoinUndone')).toEqual([]);
    expect(of("select 1 from a left join b on b.a_id = a.id where (b.status = 'X' or a.y = 1)", 'leftJoinUndone')).toEqual([]);
    expect(of("select 1 from a join b on b.a_id = a.id where b.status = 'X'", 'leftJoinUndone')).toEqual([]);
    expect(of("select 1 from orders left join items on items.oid = orders.id where items.qty > 1", 'leftJoinUndone')[0]!.params).toEqual({ alias: 'items' });
  });

  test('unusedCte and duplicateCte', () => {
    const sql = 'with a as (select 1 x from dual), b as (select x from a) select * from a';
    const p = of(sql, 'unusedCte');
    expect(p.map((x) => sql.slice(x.from, x.to))).toEqual(['b']);
    expect(p[0]!.params).toEqual({ name: 'b' });
    expect(p[0]!.step).toBe('b');
    expect(of('with a as (select 1 x from dual), b as (select x from a) select * from b', 'unusedCte')).toEqual([]);
    const dup = 'with a as (select 1 from dual), a as (select 2 from dual) select * from a';
    const d = of(dup, 'duplicateCte');
    expect(d).toHaveLength(1);
    expect(d[0]!.from).toBe(dup.indexOf('a as (select 2'));
    expect(of('with a as (select 1 from dual), b as (select 2 from a) select * from b', 'duplicateCte')).toEqual([]);
  });

  test('duplicateAlias', () => {
    expect(spans('select 1 from t x join u x on x.id = x.id', 'duplicateAlias')).toEqual(['x']);
    expect(spans('select 1 from emp, emp', 'duplicateAlias')).toEqual(['emp']);
    expect(of('select 1 from t x where exists (select 1 from u x)', 'duplicateAlias')).toEqual([]);
    expect(of('select 1 from t x union all select 1 from u x', 'duplicateAlias')).toEqual([]);
  });

  test('unbalancedParens', () => {
    expect(spans('select (1 from dual', 'unbalancedParens')).toEqual(['(']);
    const extra = 'select 1) from dual';
    expect(of(extra, 'unbalancedParens').map((p) => p.from)).toEqual([extra.indexOf(')')]);
    expect(of("select '(' from dual -- (", 'unbalancedParens')).toEqual([]);
    expect(of('begin x := (1; end;', 'unbalancedParens')).toHaveLength(1);
    expect(of('select nvl((select 1 from dual), 0) from dual', 'unbalancedParens')).toEqual([]);
  });

  test('unionDistinct', () => {
    const p = of('select 1 from a union select 2 from b', 'unionDistinct');
    expect(p).toHaveLength(1);
    expect(p[0]!.severity).toBe('info');
    expect(of('select 1 from a union all select 2 from b', 'unionDistinct')).toEqual([]);
  });

  test('selectStar', () => {
    expect(spans('insert into t select * from s', 'selectStar')).toEqual(['*']);
    expect(spans('create table t as select a.* from a', 'selectStar')).toEqual(['*']);
    expect(of('select * from t', 'selectStar')).toEqual([]);
    const cte = of('with a as (select * from t) select x from a', 'selectStar');
    expect(cte).toHaveLength(1);
    expect(cte[0]!.step).toBe('a');
    expect(of('insert into t select count(*) from s', 'selectStar')).toEqual([]);
    expect(of('insert into t select x from a where exists (select * from b)', 'selectStar')).toEqual([]);
  });

  test('cartesianJoin', () => {
    expect(spans('select 1 from a, b', 'cartesianJoin')).toEqual(['b']);
    expect(spans('select 1 from a, b x, c where x.id = c.id', 'cartesianJoin')).toEqual(['b x']);
    expect(of('select 1 from a, b where a.id = b.id', 'cartesianJoin')).toEqual([]);
    expect(of('select 1 from a x, b y where x.id = y.id(+)', 'cartesianJoin')).toEqual([]);
    expect(of('select 1 from a, b where a.id = b_id', 'cartesianJoin')).toEqual([]);
    expect(of('select 1 from a, table(a.arr) t', 'cartesianJoin')).toEqual([]);
    expect(of('select 1 from a, (select max(x) m from b) s', 'cartesianJoin')).toEqual([]);
    expect(of('select 1 from a join b on a.id = b.id', 'cartesianJoin')).toEqual([]);
  });

  test('statement index and no throw on junk', () => {
    const p = sqlLint('select 1 from dual;\nselect a from t where a = null');
    expect(p.map((x) => x.statement)).toEqual([1]);
    expect(() => sqlLint('select ( from , where = ) ) ( union')).not.toThrow();
    expect(sqlLint('')).toEqual([]);
  });

  test('marker and parameter rules', () => {
    const ok = "select 1 from c where 1=1\n/*%JS=result=('{1}'!='') %*/and c.a = {1}";
    expect(sqlLint(ok)).toEqual([]);

    const onlyCond = "select 1 from c\n/*%JS=result=('{1}'!='') %*/and c.a = 1";
    expect(of(onlyCond, 'paramOnlyInCondition').map((p) => p.params)).toEqual([{ n: '1' }]);
    expect(of(onlyCond, 'markerFragmentNoParam').length).toBe(1);
    expect(of(onlyCond, 'paramOnlyInCondition')[0]!.severity).toBe('warning');

    const gap = 'select {1}, {3} from dual';
    expect(of(gap, 'paramGap').map((p) => p.params)).toEqual([{ n: '2' }]);
    expect(of(gap, 'paramGap')[0]!.severity).toBe('info');
    expect(of('select {1}, {2} from dual', 'paramGap')).toEqual([]);

    expect(spans('select 1 from c where a in ({1})', 'unguardedIn')).toEqual(['{1}']);
    expect(of('select 1 from c where a in ({1})', 'unguardedIn')[0]!.severity).toBe('warning');
    expect(of("select 1 from c where 1=1\n/*%JS=result=('{1}'!='') %*/and a in ({1})", 'unguardedIn')).toEqual([]);

    const open = 'select 1 from c\n/*%JS=result=true and a = 1';
    expect(of(open, 'markerUnterminated').length).toBe(1);
    expect(of('select 1 from c\n/*%JS=result=true %*/', 'markerNoFragment').length).toBe(1);
    expect(of('select 1 from c\n/*%JS=result=true %*/and a = 1', 'markerNoFragment')).toEqual([]);
  });

  test('lints a 5,000-line file quickly', () => {
    const one = `with a as (
  select x.id, y.name
  from x
  left join y on y.xid = x.id
  where y.status = 'A'
    and x.v = null
),
b as (select * from a)
select a.id, b.name
from a, b, c
where a.id = b.id
  and a.code not in (select code from z)
union
select 1, 'x' from dual`;
    const big = Array.from({ length: 360 }, () => one + ';').join('\n');
    expect(big.split('\n').length).toBeGreaterThan(5000);
    const outline = sqlOutline(big);
    const t0 = performance.now();
    const out = sqlLint(big, outline);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(out.length).toBe(360 * 5);
  });
});
