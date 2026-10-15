import { describe, expect, test } from 'bun:test';
import { sqlOutline } from './outline.ts';

const BIG = `-- header: select * from fake_table
WITH orders_cte AS (
  SELECT o.id, o.customer_id, o.amount, o.order_date
  FROM sales.orders o
  WHERE o.status = 'select from x where' AND o.order_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'
    AND (o.region = 'EU' OR o.region = 'US')
),
ranked AS (
  SELECT c.id, c.name, oc.amount,
         ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY oc.order_date DESC) rn
  FROM customers c
  INNER JOIN orders_cte oc ON oc.customer_id = c.id
  LEFT JOIN regions r ON r.id = c.region_id
  RIGHT OUTER JOIN "Owner"."Accounts" a ON a.cust = c.id
  FULL JOIN audit_log au ON au.id = c.id
  CROSS JOIN settings
),
totals AS (
  SELECT customer_id, SUM(amount) AS total, COUNT(DISTINCT id) cnt
  FROM orders_cte
  GROUP BY customer_id
  HAVING SUM(amount) > 100
)
SELECT DISTINCT r.id, r.name, t.total
FROM ranked r, totals t
WHERE r.rn = 1 AND t.customer_id = r.id
UNION ALL
SELECT x.id, x.name, 0 FROM archive x
ORDER BY 1, 2`;

describe('sqlOutline', () => {
  test('explains a multi-CTE query step by step', () => {
    const out = sqlOutline(BIG);
    expect(out.statements).toHaveLength(1);
    const st = out.statements[0]!;
    expect(st.kind).toBe('select');
    expect(st.steps.map((s) => [s.name, s.kind])).toEqual([
      ['orders_cte', 'cte'],
      ['ranked', 'cte'],
      ['totals', 'cte'],
      ['', 'main'],
    ]);
    const [orders, ranked, totals, main] = st.steps as [any, any, any, any];

    expect(BIG.slice(orders.nameFrom, orders.nameTo)).toBe('orders_cte');
    expect(orders.reads.map((r: any) => [r.name, r.alias, r.cte])).toEqual([['sales.orders', 'o', false]]);
    expect(orders.filters).toEqual([
      "o.status = 'select from x where'",
      "o.order_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'",
      "(o.region = 'EU' OR o.region = 'US')",
    ]);
    expect(orders.feeds).toEqual(['ranked', 'totals']);

    expect(ranked.joins.map((j: any) => [j.type, j.target, j.alias])).toEqual([
      ['inner', 'orders_cte', 'oc'],
      ['left', 'regions', 'r'],
      ['right', '"Owner"."Accounts"', 'a'],
      ['full', 'audit_log', 'au'],
      ['cross', 'settings', undefined],
    ]);
    expect(ranked.joins[0].on).toBe('oc.customer_id = c.id');
    expect(ranked.joins[4].on).toBeUndefined();
    expect(ranked.reads.find((r: any) => r.name === 'orders_cte').cte).toBe(true);
    expect(ranked.windows).toEqual(['ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY oc.order_date DESC)']);
    expect(ranked.dedupe).toBe(true);
    expect(ranked.feeds).toEqual(['main']);

    expect(totals.groupBy).toEqual(['customer_id']);
    expect(totals.aggregates).toEqual(['SUM(amount)', 'COUNT(DISTINCT id)']);
    expect(totals.having).toBe('SUM(amount) > 100');
    expect(totals.distinct).toBe(false);
    expect(totals.feeds).toEqual(['main']);

    expect(main.distinct).toBe(true);
    expect(main.setOps).toEqual(['union all']);
    expect(main.joins).toEqual([{ type: 'comma', target: 'totals', alias: 't' }]);
    expect(main.filters).toEqual(['r.rn = 1', 't.customer_id = r.id']);
    expect(main.reads.map((r: any) => [r.name, r.cte])).toEqual([
      ['ranked', true],
      ['totals', true],
      ['archive', false],
    ]);
    expect(main.orderBy).toEqual(['1', '2']);

    expect(out.tables).toEqual(['sales.orders', 'customers', 'regions', '"Owner"."Accounts"', 'audit_log', 'settings', 'archive']);
  });

  test('insert-select targets and WITH inside insert', () => {
    const [a, b] = sqlOutline(
      'insert into hr.emp_copy (id, name) select e.id, e.name from hr.emp e where e.dept = 10;\n' +
        'insert into t with a as (select * from b) select * from a',
    ).statements;
    expect(a!.kind).toBe('insert');
    expect(a!.target).toBe('hr.emp_copy');
    expect(a!.steps[0]!.reads[0]!.name).toBe('hr.emp');
    expect(a!.steps[0]!.filters).toEqual(['e.dept = 10']);
    expect(b!.steps.map((s) => s.name)).toEqual(['a', '']);
    expect(b!.steps[0]!.feeds).toEqual(['main']);
  });

  test('update, delete, merge and create targets', () => {
    const [u, d, m, c] = sqlOutline(
      'update emp e set e.sal = (select avg(sal) from emp2) where e.id = 1;\n' +
        'delete from logs where created < sysdate - 30;\n' +
        'merge into dst d using (select * from src) s on (d.id = s.id) when matched then update set d.v = s.v ' +
        'when not matched then insert (id, v) values (s.id, s.v);\n' +
        'create table t2 as select * from t1',
    ).statements;
    expect([u!.kind, u!.target]).toEqual(['update', 'emp']);
    expect(u!.steps[0]!.subqueries).toBe(1);
    expect(u!.steps[0]!.reads.map((r) => r.name)).toEqual(['emp2']);
    expect(u!.steps[0]!.filters).toEqual(['e.id = 1']);
    expect([d!.kind, d!.target]).toEqual(['delete', 'logs']);
    expect(d!.steps[0]!.filters).toEqual(['created < sysdate - 30']);
    expect([m!.kind, m!.target]).toEqual(['merge', 'dst']);
    expect(m!.steps[0]!.reads.map((r) => r.name)).toEqual(['src']);
    expect(m!.steps[0]!.filters).toEqual(['(d.id = s.id)']);
    expect([c!.kind, c!.target]).toEqual(['create', 't2']);
    expect(c!.steps[0]!.reads.map((r) => r.name)).toEqual(['t1']);
  });

  test('PL/SQL blocks have no steps', () => {
    const out = sqlOutline('begin\n  update x set y = 1;\nend;\n/\nselect 1 from dual');
    expect(out.statements.map((s) => s.kind)).toEqual(['plsql', 'select']);
    expect(out.statements[0]!.steps).toEqual([]);
  });

  test('broken SQL does not throw', () => {
    for (const s of ['with a as (select * from t where (x = 1', 'select from where ( (', '', 'select count( from', ') ) select']) {
      expect(() => sqlOutline(s)).not.toThrow();
    }
    expect(sqlOutline('with a as (select * from t where (x = 1').statements[0]!.steps[0]!.reads[0]!.name).toBe('t');
  });

  test('ignores keywords in comments and strings', () => {
    const step = sqlOutline(
      "select /* from hidden */ a, q'[from z]' -- join other\n from t where note = 'and where from x' and b = 1",
    ).statements[0]!.steps[0]!;
    expect(step.reads.map((r) => r.name)).toEqual(['t']);
    expect(step.joins).toEqual([]);
    expect(step.filters).toEqual(["note = 'and where from x'", 'b = 1']);
  });

  test('subquery dedupe, rownum and fetch limits', () => {
    const a = sqlOutline(
      'select * from (select x, row_number() over (order by y) rn from t) where rn = 1 and rownum <= 10',
    ).statements[0]!.steps[0]!;
    expect(a.subqueries).toBe(1);
    expect(a.reads.map((r) => r.name)).toEqual(['t']);
    expect(a.dedupe).toBe(true);
    expect(a.limit).toBe('rownum <= 10');
    const b = sqlOutline('select * from t order by a desc fetch first 5 rows only').statements[0]!.steps[0]!;
    expect(b.orderBy).toEqual(['a desc']);
    expect(b.limit).toBe('fetch first 5 rows only');
  });

  test('handles a 5,000-line file quickly', () => {
    const big = Array.from({ length: 180 }, () => BIG + ';').join('\n');
    expect(big.split('\n').length).toBeGreaterThan(5000);
    const t0 = performance.now();
    const out = sqlOutline(big);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(out.statements).toHaveLength(180);
  });
});
