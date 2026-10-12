import { describe, expect, test } from 'bun:test';
import { DEFAULT_FORMAT_OPTIONS, FORMAT_OPTION_META, formatSql, type SqlFormatOptions } from './format.ts';

const q = (s: string): string => s.replace(/^\n/, '').replace(/\n$/, '');

interface Fixture {
  name: string;
  options?: Partial<SqlFormatOptions>;
  input: string;
  expected: string;
}

const fmt = (text: string, options: Partial<SqlFormatOptions> = {}): string => formatSql(text, { ...DEFAULT_FORMAT_OPTIONS, ...options });

const EXPANDED: Partial<SqlFormatOptions> = {
  columnsPerLine: 1,
  newlineAfterSelect: true,
  singleColumnInline: false,
  conditionPerLine: true,
};

const FIXTURES: Fixture[] = [
  {
    name: 'select list with the defaults, first items on the SELECT line, three per line',
    input: 'select a, b, c, d, e from t',
    expected: q(`
SELECT a, b, c,
  d, e
FROM t
`),
  },
  {
    name: 'select list, one item per line, list on the next line',
    options: { columnsPerLine: 1, newlineAfterSelect: true },
    input: 'select a, b, c from t',
    expected: q(`
SELECT
  a,
  b,
  c
FROM t
`),
  },
  {
    name: 'select list, three items per line, list on the next line',
    options: { columnsPerLine: 3, newlineAfterSelect: true },
    input: 'select a, b, c, d, e from t',
    expected: q(`
SELECT
  a, b, c,
  d, e
FROM t
`),
  },
  {
    name: 'select list, first item on the SELECT line, one per line',
    options: { columnsPerLine: 1 },
    input: 'select a, b, c from t',
    expected: q(`
SELECT a,
  b,
  c
FROM t
`),
  },
  {
    name: 'select distinct and wildcard',
    input: 'select distinct t.*, count(*) from t',
    expected: q(`
SELECT DISTINCT t.*, COUNT(*)
FROM t
`),
  },
  {
    name: 'single select item stays on the SELECT line even when the list starts on the next line',
    options: { newlineAfterSelect: true },
    input: 'select nvl(a, 0) from t where x in (select b from u)',
    expected: q(`
SELECT nvl(a, 0)
FROM t
WHERE x IN (
  SELECT b
  FROM u
)
`),
  },
  {
    name: 'several select items still start on the next line with single column inline',
    options: { newlineAfterSelect: true },
    input: 'select a, b from t where x in (select c from u)',
    expected: q(`
SELECT
  a, b
FROM t
WHERE x IN (
  SELECT c
  FROM u
)
`),
  },
  {
    name: 'single select item on the next line without single column inline',
    options: { newlineAfterSelect: true, singleColumnInline: false },
    input: 'select a from t where x in (select b from u)',
    expected: q(`
SELECT
  a
FROM t
WHERE x IN (
  SELECT
    b
  FROM u
)
`),
  },
  {
    name: 'from with joins and on conditions',
    input:
      'select e.name, d.name from emp e inner join dept d on e.dept_id = d.id and d.active = 1 left join loc l on l.id = d.loc_id where e.sal > 100',
    expected: q(`
SELECT e.name, d.name
FROM emp e
INNER JOIN dept d
  ON e.dept_id = d.id AND d.active = 1
LEFT JOIN loc l
  ON l.id = d.loc_id
WHERE e.sal > 100
`),
  },
  {
    name: 'join conditions on the join line',
    options: { joinConditionOnNewLine: false },
    input: 'select a from t join u on t.id = u.id and t.x = u.x left join v using (id)',
    expected: q(`
SELECT a
FROM t
JOIN u ON t.id = u.id AND t.x = u.x
LEFT JOIN v USING (id)
`),
  },
  {
    name: 'join conditions on the join line, one condition per line',
    options: { joinConditionOnNewLine: false, conditionPerLine: true },
    input: 'select a from t join u on t.id = u.id and t.x = u.x where t.y = 1',
    expected: q(`
SELECT a
FROM t
JOIN u ON t.id = u.id
  AND t.x = u.x
WHERE t.y = 1
`),
  },
  {
    name: 'comma-separated tables in from, one per line',
    input: 'select a from t1, t2 x, t3',
    expected: q(`
SELECT a
FROM t1,
  t2 x,
  t3
`),
  },
  {
    name: 'comma-separated tables in from on one line',
    options: { fromTablesPerLine: false },
    input: 'select a from t1, t2 x, t3',
    expected: q(`
SELECT a
FROM t1, t2 x, t3
`),
  },
  {
    name: 'where with and/or, one condition per line, groups and between kept together',
    options: { conditionPerLine: true },
    input: 'select a from t where a = 1 and (b = 2 or c = 3) or d between 1 and 5 and e in (1, 2)',
    expected: q(`
SELECT a
FROM t
WHERE a = 1
  AND (b = 2 OR c = 3)
  OR d BETWEEN 1 AND 5
  AND e IN (1, 2)
`),
  },
  {
    name: 'where with and/or at the end of the line',
    options: { conditionPerLine: true, andOrPosition: 'after' },
    input: 'select a from t where a = 1 and (b = 2 or c = 3) or d between 1 and 5 and e in (1, 2)',
    expected: q(`
SELECT a
FROM t
WHERE a = 1 AND
  (b = 2 OR c = 3) OR
  d BETWEEN 1 AND 5 AND
  e IN (1, 2)
`),
  },
  {
    name: 'and/or position does not matter without one condition per line',
    options: { conditionPerLine: false, andOrPosition: 'after' },
    input: 'select a from t where a = 1 and b = 2',
    expected: q(`
SELECT a
FROM t
WHERE a = 1 AND b = 2
`),
  },
  {
    name: 'where with and/or on one line',
    input: 'select a from t where a = 1 and (b = 2 or c = 3) or d between 1 and 5',
    expected: q(`
SELECT a
FROM t
WHERE a = 1 AND (b = 2 OR c = 3) OR d BETWEEN 1 AND 5
`),
  },
  {
    name: 'on conditions on one line',
    input: 'select a from t join u on t.id = u.id and t.x = u.x where t.y = 1 and u.z = 2',
    expected: q(`
SELECT a
FROM t
JOIN u
  ON t.id = u.id AND t.x = u.x
WHERE t.y = 1 AND u.z = 2
`),
  },
  {
    name: 'having conditions',
    input: 'select dept from emp group by dept having count(*) > 1 and max(sal) < 10',
    expected: q(`
SELECT dept
FROM emp
GROUP BY dept
HAVING COUNT(*) > 1 AND max(sal) < 10
`),
  },
  {
    name: 'group by and order by on one line',
    input: 'select dept, count(*) from emp group by dept, region order by dept desc, 2',
    expected: q(`
SELECT dept, COUNT(*)
FROM emp
GROUP BY dept, region
ORDER BY dept DESC, 2
`),
  },
  {
    name: 'group by and order by, one item per line',
    options: { groupOrderListPerLine: true },
    input: 'select dept, count(*) from emp group by dept, region order by dept desc, 2',
    expected: q(`
SELECT dept, COUNT(*)
FROM emp
GROUP BY dept,
  region
ORDER BY dept DESC,
  2
`),
  },
  {
    name: 'order by inside an analytic function stays inline',
    options: { groupOrderListPerLine: true },
    input: 'select sum(x) over (partition by a, b order by c, d) from t',
    expected: q(`
SELECT sum(x) OVER (PARTITION BY a, b ORDER BY c, d)
FROM t
`),
  },
  {
    name: 'union all',
    input: 'select a from t union all select b from u union select c from v',
    expected: q(`
SELECT a
FROM t
UNION ALL
SELECT b
FROM u
UNION
SELECT c
FROM v
`),
  },
  {
    name: 'subquery in from',
    input: 'select x.a from (select a from t where a > 1) x join u on u.id = x.a',
    expected: q(`
SELECT x.a
FROM (
  SELECT a
  FROM t
  WHERE a > 1
) x
JOIN u
  ON u.id = x.a
`),
  },
  {
    name: 'subquery in where',
    options: { conditionPerLine: true },
    input: 'select a from t where a in (select b from u where b > 1) and c = 2',
    expected: q(`
SELECT a
FROM t
WHERE a IN (
  SELECT b
  FROM u
  WHERE b > 1
)
  AND c = 2
`),
  },
  {
    name: 'subquery without a line break after the opening parenthesis',
    options: { subqueryNewlineAfterParen: false },
    input: 'select a from t where x in (select b from u where b > 1) and c = 2',
    expected: q(`
SELECT a
FROM t
WHERE x IN (SELECT b
  FROM u
  WHERE b > 1
) AND c = 2
`),
  },
  {
    name: 'subquery with the closing parenthesis on the last line',
    options: { subqueryCloseParenOnOwnLine: false },
    input: 'select a from t where x in (select b from u where b > 1) and c = 2',
    expected: q(`
SELECT a
FROM t
WHERE x IN (
  SELECT b
  FROM u
  WHERE b > 1) AND c = 2
`),
  },
  {
    name: 'subquery fully hugging its parentheses',
    options: { subqueryNewlineAfterParen: false, subqueryCloseParenOnOwnLine: false },
    input: 'select a from t where x in (select b from u where b > 1) and c = 2',
    expected: q(`
SELECT a
FROM t
WHERE x IN (SELECT b
  FROM u
  WHERE b > 1) AND c = 2
`),
  },
  {
    name: 'nested subquery',
    options: { conditionPerLine: true },
    input: 'select a from t where exists (select 1 from u where u.id = t.id and u.k in (select k from v))',
    expected: q(`
SELECT a
FROM t
WHERE EXISTS (
  SELECT 1
  FROM u
  WHERE u.id = t.id
    AND u.k IN (
      SELECT k
      FROM v
    )
)
`),
  },
  {
    name: 'scalar subquery in the select list',
    input: 'select a, (select max(b) from u) m from t',
    expected: q(`
SELECT a, (
  SELECT max(b)
  FROM u
) m
FROM t
`),
  },
  {
    name: 'with clause',
    input: 'with x as (select a from t), y as (select b from u) select x.a, y.b from x, y',
    expected: q(`
WITH x AS (
  SELECT a
  FROM t
),
y AS (
  SELECT b
  FROM u
)
SELECT x.a, y.b
FROM x,
  y
`),
  },
  {
    name: 'case expression with when on own lines',
    options: { newlineAfterSelect: true, columnsPerLine: 1, caseLayout: 'always' },
    input: "select case when a = 1 then 'x' when a = 2 and b = 3 then 'y' else 'z' end as c, d from t",
    expected: q(`
SELECT
  CASE
    WHEN a = 1 THEN 'x'
    WHEN a = 2 AND b = 3 THEN 'y'
    ELSE 'z'
  END AS c,
  d
FROM t
`),
  },
  {
    name: 'case expression on one line',
    options: { caseLayout: 'never' },
    input: "select case when a = 1 then 'x' when a = 2 and b = 3 then 'y' else 'z' end as c, d from t",
    expected: q(`
SELECT CASE WHEN a = 1 THEN 'x' WHEN a = 2 AND b = 3 THEN 'y' ELSE 'z' END AS c, d
FROM t
`),
  },
  {
    name: 'case in where and nested case',
    options: { caseLayout: 'always' },
    input: "select a from t where b = case when c = 1 then case when d = 2 then 3 else 4 end else 5 end",
    expected: q(`
SELECT a
FROM t
WHERE b = CASE
  WHEN c = 1 THEN CASE
    WHEN d = 2 THEN 3
    ELSE 4
  END
  ELSE 5
END
`),
  },
  {
    name: 'nested case on one line',
    options: { caseLayout: 'never' },
    input: "select a from t where b = case when c = 1 then case when d = 2 then 3 else 4 end else 5 end",
    expected: q(`
SELECT a
FROM t
WHERE b = CASE WHEN c = 1 THEN CASE WHEN d = 2 THEN 3 ELSE 4 END ELSE 5 END
`),
  },
  {
    name: 'short case stays on one line in the select list',
    input: "select a, case when a > 1 then 'x' else 'y' end as c, d from t",
    expected: q(`
SELECT a, CASE WHEN a > 1 THEN 'x' ELSE 'y' END AS c, d
FROM t
`),
  },
  {
    name: 'big case in the select list starts on its own line with items before and after',
    options: { caseMaxWidth: 40 },
    input: "select a, b, case when a > 1 then 'high' when a > 0 then 'mid' else 'low' end as band, d, e from t",
    expected: q(`
SELECT a, b,
  CASE
    WHEN a > 1 THEN 'high'
    WHEN a > 0 THEN 'mid'
    ELSE 'low'
  END AS band,
  d, e
FROM t
`),
  },
  {
    name: 'big leading case in the select list does not sit on the SELECT line',
    options: { caseMaxWidth: 20 },
    input: "select case when a > 1 then 'x' else 'y' end as c, d from t",
    expected: q(`
SELECT
  CASE
    WHEN a > 1 THEN 'x'
    ELSE 'y'
  END AS c,
  d
FROM t
`),
  },
  {
    name: 'big single case in the select list',
    options: { caseMaxWidth: 20 },
    input: "select case when a > 1 then 'x' else 'y' end from t",
    expected: q(`
SELECT
  CASE
    WHEN a > 1 THEN 'x'
    ELSE 'y'
  END
FROM t
`),
  },
  {
    name: 'big case in where',
    options: { caseMaxWidth: 20 },
    input: "select a from t where b = case when c = 1 then 'x' else 'y' end and d = 1",
    expected: q(`
SELECT a
FROM t
WHERE b = CASE
  WHEN c = 1 THEN 'x'
  ELSE 'y'
END AND d = 1
`),
  },
  {
    name: 'big case in an on condition',
    options: { caseMaxWidth: 20 },
    input: "select a from t join u on u.k = case when t.c = 1 then 'x' else 'y' end",
    expected: q(`
SELECT a
FROM t
JOIN u
  ON u.k = CASE
    WHEN t.c = 1 THEN 'x'
    ELSE 'y'
  END
`),
  },
  {
    name: 'nested case, only the big one breaks',
    options: { caseMaxWidth: 40 },
    input: "select case when c = 1 then case when d = 2 then 3 else 4 end when c = 2 then 'a long text value' else 5 end as v from t",
    expected: q(`
SELECT
  CASE
    WHEN c = 1 THEN CASE WHEN d = 2 THEN 3 ELSE 4 END
    WHEN c = 2 THEN 'a long text value'
    ELSE 5
  END AS v
FROM t
`),
  },
  {
    name: 'nested case that is itself too big breaks too',
    options: { caseMaxWidth: 30 },
    input: "select a, case when c = 1 then case when d = 2 then 'first value' else 'second value' end else 5 end as v from t",
    expected: q(`
SELECT a,
  CASE
    WHEN c = 1 THEN CASE
      WHEN d = 2 THEN 'first value'
      ELSE 'second value'
    END
    ELSE 5
  END AS v
FROM t
`),
  },
  {
    name: 'case with a comment always breaks',
    input: "select a, case when a > 1 then 'x' /* why */ else 'y' end as c from t",
    expected: q(`
SELECT a,
  CASE
    WHEN a > 1 THEN 'x' /* why */
    ELSE 'y'
  END AS c
FROM t
`),
  },
  {
    name: 'case with a subquery always breaks',
    input: "select a, case when a in (select b from u) then 1 else 0 end as c from t",
    expected: q(`
SELECT a,
  CASE
    WHEN a IN (
      SELECT b
      FROM u
    ) THEN 1
    ELSE 0
  END AS c
FROM t
`),
  },
  {
    name: 'case exactly at the maximum width stays on one line',
    options: { caseMaxWidth: 29 },
    input: "select case when a then 1 else 2 end as c from t",
    expected: q(`
SELECT CASE WHEN a THEN 1 ELSE 2 END AS c
FROM t
`),
  },
  {
    name: 'case one character over the maximum width breaks',
    options: { caseMaxWidth: 28 },
    input: "select case when a then 1 else 2 end as c from t",
    expected: q(`
SELECT
  CASE
    WHEN a THEN 1
    ELSE 2
  END AS c
FROM t
`),
  },
  {
    name: 'case layout always breaks a short case',
    options: { caseLayout: 'always' },
    input: "select a, case when a then 1 else 2 end as c, d from t",
    expected: q(`
SELECT a,
  CASE
    WHEN a THEN 1
    ELSE 2
  END AS c,
  d
FROM t
`),
  },
  {
    name: 'case layout never keeps a big case on one line',
    options: { caseLayout: 'never', caseMaxWidth: 5 },
    input: "select a, case when a then 1 else 2 end as c, d from t",
    expected: q(`
SELECT a, CASE WHEN a THEN 1 ELSE 2 END AS c, d
FROM t
`),
  },
  {
    name: 'function calls stay inline',
    input: "select nvl(a,0), upper(trim(b)), to_char(sysdate,'YYYY'), sum(x) over (partition by y order by z) from t",
    expected: q(`
SELECT nvl(a, 0), upper(trim(b)), to_char(sysdate, 'YYYY'),
  sum(x) OVER (PARTITION BY y ORDER BY z)
FROM t
`),
  },
  {
    name: 'function names in upper case',
    options: { functionCase: 'upper' },
    input: 'select nvl(a, 0), Sum(x) over (partition by y), count(*), x.fn(1), t.col from tab t, u where t.k = u.y(+)',
    expected: q(`
SELECT NVL(a, 0), SUM(x) OVER (PARTITION BY y), COUNT(*),
  x.FN(1), t.col
FROM tab t,
  u
WHERE t.k = u.y(+)
`),
  },
  {
    name: 'function names in lower case, keyword functions follow the keyword case',
    options: { functionCase: 'lower' },
    input: 'select NVL(a, 0), SUM(x) over (partition by y), COUNT(*), t.col from tab t',
    expected: q(`
SELECT nvl(a, 0), sum(x) OVER (PARTITION BY y), COUNT(*),
  t.col
FROM tab t
`),
  },
  {
    name: 'function case leaves the insert table alone',
    options: { functionCase: 'upper' },
    input: 'insert into Emp (id) values (nvl(1, 2))',
    expected: q(`
INSERT INTO Emp (id)
VALUES (NVL(1, 2))
`),
  },
  {
    name: 'operators and unary signs',
    input: "select a+b*2, -c, a||'x', (d-1)/2 from t where t.x = u.y(+) and z > -1",
    expected: q(`
SELECT a + b * 2, -c, a || 'x',
  (d - 1) / 2
FROM t
WHERE t.x = u.y(+) AND z > -1
`),
  },
  {
    name: 'operators without surrounding spaces',
    options: { spaceAroundOperators: false },
    input: "select a + b * 2, -c, a || 'x', (d - 1) / 2, a - -1, * from t where t.x = u.y(+) and z > -1 and w = -1",
    expected: q(`
SELECT a+b*2, -c, a||'x',
  (d-1)/2, a- -1, *
FROM t
WHERE t.x=u.y(+) AND z>-1 AND w=-1
`),
  },
  {
    name: 'insert values',
    input: "insert into emp (id, name) values (1, 'a')",
    expected: q(`
INSERT INTO emp (id, name)
VALUES (1, 'a')
`),
  },
  {
    name: 'insert select',
    input: 'insert into emp (id) select id from tmp where x = 1',
    expected: q(`
INSERT INTO emp (id)
SELECT id
FROM tmp
WHERE x = 1
`),
  },
  {
    name: 'update set, one item per line',
    input: 'update emp set sal = sal * 1.1, bonus = 0 where dept = 10 and active = 1',
    expected: q(`
UPDATE emp
SET sal = sal * 1.1,
  bonus = 0
WHERE dept = 10 AND active = 1
`),
  },
  {
    name: 'update set on one line',
    options: { setItemsPerLine: false },
    input: 'update emp set sal = sal * 1.1, bonus = 0 where dept = 10 and active = 1',
    expected: q(`
UPDATE emp
SET sal = sal * 1.1, bonus = 0
WHERE dept = 10 AND active = 1
`),
  },
  {
    name: 'delete',
    input: 'delete from emp where id = 1 or id = 2',
    expected: q(`
DELETE FROM emp
WHERE id = 1 OR id = 2
`),
  },
  {
    name: 'comments stay in place',
    input: q(`
-- header
select a, -- first
  b /* second */
from t -- the table
-- filter
where a = 1
`),
    expected: q(`
-- header
SELECT a, -- first
  b /* second */
FROM t -- the table
-- filter
WHERE a = 1
`),
  },
  {
    name: 'comments between select items and before a closing paren',
    input: q(`
select a,
/* note */
b from (select 1 from dual
-- last
) x
`),
    expected: q(`
SELECT a,
  /* note */
  b
FROM (
  SELECT 1
  FROM dual
  -- last
) x
`),
  },
  {
    name: 'optimizer hint stays on the select line',
    input: 'select /*+ index(t ix) */ a from t',
    expected: q(`
SELECT /*+ index(t ix) */ a
FROM t
`),
  },
  {
    name: 'trailing line comment before the terminator',
    input: 'select a from t -- done\n;',
    expected: q(`
SELECT a
FROM t -- done
;
`),
  },
  {
    name: 'several statements with a blank line between',
    input: 'select 1 from dual; select 2 from dual;',
    expected: q(`
SELECT 1
FROM dual;

SELECT 2
FROM dual;
`),
  },
  {
    name: 'several statements without a blank line between',
    options: { blankLineBetweenStatements: false },
    input: 'select 1 from dual;\n\n\nselect 2 from dual;',
    expected: q(`
SELECT 1
FROM dual;
SELECT 2
FROM dual;
`),
  },
  {
    name: 'pl/sql block only changes keyword case',
    input: q(`
begin
  select count(*) into v from t where x = 1;
  if v > 0 then
      null;
  end if;
end;
/
`),
    expected: q(`
BEGIN
  SELECT COUNT(*) INTO v FROM t WHERE x = 1;
  IF v > 0 THEN
      NULL;
  END IF;
END;
/
`),
  },
  {
    name: 'create procedure only changes keyword case',
    input: q(`
create or replace procedure p is
begin
    insert into t values (1);
end p;
/
select a from t;
`),
    expected: q(`
CREATE OR REPLACE PROCEDURE p IS
BEGIN
    INSERT INTO t VALUES (1);
END p;
/

SELECT a
FROM t;
`),
  },
  {
    name: 'statement with unbalanced parentheses only changes keyword case',
    input: 'select a  from t\n where (a = 1',
    expected: 'SELECT a  FROM t\n WHERE (a = 1',
  },
  {
    name: 'ddl only changes keyword case',
    input: 'create table t (\n  id number,\n  name varchar2(10)\n)',
    expected: 'CREATE TABLE t (\n  id number,\n  name varchar2(10)\n)',
  },
  {
    name: 'keywords after a dot and inside strings and quoted identifiers are untouched',
    input: `select t.type, 'from', "where" from t`,
    expected: q(`
SELECT t.type, 'from', "where"
FROM t
`),
  },
  {
    name: 'lower case keywords',
    options: { keywordCase: 'lower' },
    input: 'SELECT COUNT(*) FROM T WHERE A = 1 ORDER BY A',
    expected: q(`
select count(*)
from T
where A = 1
order by A
`),
  },
  {
    name: 'preserved keyword case',
    options: { keywordCase: 'preserve' },
    input: 'Select a From t Where a = 1',
    expected: q(`
Select a
From t
Where a = 1
`),
  },
  {
    name: 'indent of four spaces',
    options: { indent: 4, conditionPerLine: true },
    input: 'select a from t where a in (select b from u) and c = 1',
    expected: q(`
SELECT a
FROM t
WHERE a IN (
    SELECT b
    FROM u
)
    AND c = 1
`),
  },
  {
    name: 'indent with tabs',
    options: { indent: 'tab', columnsPerLine: 1, conditionPerLine: true },
    input: 'select a, b from t where a = 1 and b = 2',
    expected: 'SELECT a,\n\tb\nFROM t\nWHERE a = 1\n\tAND b = 2',
  },
  {
    name: 'already formatted input is unchanged',
    options: { ...EXPANDED, caseLayout: 'always' },
    input: q(`
SELECT
  e.name,
  CASE
    WHEN e.sal > 100 THEN 'high'
    ELSE 'low'
  END AS band
FROM emp e
INNER JOIN dept d
  ON e.dept_id = d.id
WHERE e.active = 1
  AND e.dept_id IN (
    SELECT
      id
    FROM dept
  )
ORDER BY e.name;
`),
    expected: q(`
SELECT
  e.name,
  CASE
    WHEN e.sal > 100 THEN 'high'
    ELSE 'low'
  END AS band
FROM emp e
INNER JOIN dept d
  ON e.dept_id = d.id
WHERE e.active = 1
  AND e.dept_id IN (
    SELECT
      id
    FROM dept
  )
ORDER BY e.name;
`),
  },
];

describe('formatSql fixtures', () => {
  for (const f of FIXTURES) {
    test(f.name, () => {
      expect(fmt(f.input, f.options)).toBe(f.expected);
    });
  }
});

describe('formatSql idempotence', () => {
  for (const f of FIXTURES) {
    test(f.name, () => {
      const once = fmt(f.input, f.options);
      expect(fmt(once, f.options)).toBe(once);
    });
  }
});

describe('formatSql guarantees', () => {
  test('returns whitespace-only and empty input unchanged', () => {
    expect(fmt('')).toBe('');
    expect(fmt('  \n ')).toBe('  \n ');
  });

  test('keeps leading and trailing whitespace of the text', () => {
    expect(fmt('\n\nselect a from t;\n')).toBe('\n\nSELECT a\nFROM t;\n');
  });

  test('keeps a trailing comment after the last statement', () => {
    expect(fmt('select a from t; -- end')).toBe('SELECT a\nFROM t;\n-- end');
  });

  test('uses crlf line breaks when the text does', () => {
    expect(fmt('select a from t;\r\nselect b from u;')).toBe('SELECT a\r\nFROM t;\r\n\r\nSELECT b\r\nFROM u;');
  });

  test('only changes keyword case, never other tokens', () => {
    const input = `select a.b, "Mixed" as m, n'x', q'[y]', :bind, 1.5e3 from t@link x where x.c <> :bind`;
    const out = fmt(input, { keywordCase: 'preserve' });
    expect(out.replace(/\s+/g, '')).toBe(input.replace(/\s+/g, ''));
  });

  test('only changes case, never other tokens, with every option flipped', () => {
    const input = `select a.b, "Mixed" as m, n'x', q'[y]', :bind, 1.5e3 - -2, f(x) from t@link x where x.c <> :bind and y(+) = 1`;
    const out = fmt(input, {
      functionCase: 'upper',
      conditionPerLine: true,
      andOrPosition: 'after',
      spaceAroundOperators: false,
      caseLayout: 'never',
      subqueryNewlineAfterParen: false,
    });
    expect(out.replace(/\s+/g, '').toLowerCase()).toBe(input.replace(/\s+/g, '').toLowerCase());
  });

  test('treats columnsPerLine below one as one', () => {
    expect(fmt('select a, b from t', { columnsPerLine: 0 })).toBe('SELECT a,\n  b\nFROM t');
  });
});

describe('FORMAT_OPTION_META', () => {
  test('lists every option once, in line with the defaults', () => {
    const keys: string[] = FORMAT_OPTION_META.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(DEFAULT_FORMAT_OPTIONS).sort());
    for (const m of FORMAT_OPTION_META) {
      const value = DEFAULT_FORMAT_OPTIONS[m.key];
      if (m.kind === 'boolean') expect(typeof value).toBe('boolean');
      else if (m.kind === 'number') expect(typeof value).toBe('number');
      else expect(m.values?.includes(value as string | number)).toBe(true);
    }
  });
});
