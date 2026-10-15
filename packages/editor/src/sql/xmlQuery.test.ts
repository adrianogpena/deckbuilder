import { describe, expect, test } from 'bun:test';
import { applyCombinedXml, combineXmlStatements, parseXmlQueries, splitXmlStatements, spliceXmlStatement } from './xmlQuery';
import { splitStatements } from './statements';

const wrap = (inner: string) => `<?xml version="1.0"?>\r\n<queries>\r\n<!-- <statement>x</statement> -->\r\n${inner}\r\n</queries>\r\n`;
const one = (stmt: string) => wrap(`<query name="q" set-name="s">\r\n  <statement>${stmt}</statement>\r\n</query>`);

describe('parseXmlQueries', () => {
  test('CDATA', () => {
    const x = parseXmlQueries(one('\r\n<![CDATA[\r\nSELECT 1 FROM a WHERE b < 2\r\n]]>\r\n'));
    expect(x?.statements).toHaveLength(1);
    expect(x?.statements[0].sql).toBe('\r\nSELECT 1 FROM a WHERE b < 2\r\n');
    expect(x?.statements[0].label).toBe('q');
  });
  test('prefix and CDATA', () => {
    const text = one('/*%JS=1%*/\n<![CDATA[SELECT 1]]>');
    const x = parseXmlQueries(text);
    expect(x?.statements[0].sql).toBe('/*%JS=1%*/\nSELECT 1');
    const next = spliceXmlStatement(text, x!.statements[0], '/*%JS=1%*/\nSELECT 2');
    expect(next).toBe(text.replace('SELECT 1', 'SELECT 2'));
  });
  test('plain escaped', () => {
    const text = one('SELECT a FROM t WHERE x &lt; 1 AND y = &apos;&amp;&apos;');
    const x = parseXmlQueries(text)!;
    expect(x.statements[0].sql).toBe("SELECT a FROM t WHERE x < 1 AND y = '&'");
    expect(spliceXmlStatement(text, x.statements[0], 'SELECT 1 < 2 & 3')).toBe(one('SELECT 1 &lt; 2 &amp; 3'));
  });
  test('multiple and nested', () => {
    const text = wrap('<query name="a"><statement><![CDATA[S1]]></statement><query set-name="b"><statement><![CDATA[S2]]></statement></query></query><query><statement><![CDATA[S3]]></statement></query>');
    const x = parseXmlQueries(text)!;
    expect(x.statements.map((s) => s.sql)).toEqual(['S1', 'S2', 'S3']);
    expect(x.statements.map((s) => s.label)).toEqual(['a', 'b', '#3']);
    const next = spliceXmlStatement(text, x.statements[1], 'NEW');
    expect(next).toBe(text.replace('S2', 'NEW'));
    expect(parseXmlQueries(next)!.statements.map((s) => s.sql)).toEqual(['S1', 'NEW', 'S3']);
  });
  test('non-queries root and empty', () => {
    expect(parseXmlQueries('<Connector><statement>x</statement></Connector>')).toBeNull();
    expect(parseXmlQueries('')).toBeNull();
    expect(parseXmlQueries('<queries><!-- none --></queries>')).toBeNull();
  });
  test(']]> in SQL', () => {
    const text = one('<![CDATA[SELECT 1]]>');
    const st = parseXmlQueries(text)!.statements[0];
    const next = spliceXmlStatement(text, st, "SELECT ']]>'");
    expect(next).toContain(']]]]><![CDATA[>');
    expect(parseXmlQueries(next)!.statements[0].sql).toBe("SELECT ']]>'");
  });
  test('round trip untouched', () => {
    const text = one('\r\n  <![CDATA[\r\nSELECT 1\r\n]]>\r\n  ');
    const st = parseXmlQueries(text)!.statements[0];
    expect(spliceXmlStatement(text, st, st.sql)).toBe(text);
    expect(spliceXmlStatement(text, st, 'X')).toBe(one('\r\n  <![CDATA[X]]>\r\n  '));
  });
});

describe('combined statements', () => {
  const multi = (n: number, eol = '\r\n') => wrap(Array.from({ length: n }, (_, i) => `<query name="q${i + 1}">${eol}  <statement><![CDATA[${eol}SELECT ${i + 1} FROM t${i % 2 ? ` -- c${eol}` : `;${eol}`}]]></statement>${eol}</query>`).join(eol));
  for (const n of [2, 4]) {
    test(`round trip ${n}`, () => {
      const text = multi(n);
      const x = parseXmlQueries(text)!;
      const combined = combineXmlStatements(x.statements);
      expect(combined.split('\n').filter((l) => l.startsWith('-- ==== '))).toHaveLength(n);
      expect(splitXmlStatements(x.statements, combined)).toEqual(x.statements.map((s) => s.sql));
      expect(applyCombinedXml(text, x.statements, combined)).toBe(text);
    });
  }
  test('statements stay separable', () => {
    const x = parseXmlQueries(multi(4))!;
    expect(splitStatements(combineXmlStatements(x.statements))).toHaveLength(4);
  });
  test('edit of the second statement only', () => {
    const text = multi(2);
    const x = parseXmlQueries(text)!;
    const combined = combineXmlStatements(x.statements).replace('SELECT 2', 'SELECT 22');
    expect(applyCombinedXml(text, x.statements, combined)).toBe(text.replace('SELECT 2', 'SELECT 22'));
  });
  test('deleted separator keeps all text', () => {
    const text = multi(3);
    const x = parseXmlQueries(text)!;
    const combined = combineXmlStatements(x.statements).replace('-- ==== q2 ====\n', '');
    const sqls = splitXmlStatements(x.statements, combined);
    expect(sqls[0]).toContain('SELECT 2');
    expect(sqls[1]).toBe('');
    expect(sqls[2]).toBe(x.statements[2]!.sql);
  });
  test('text before first separator goes to statement 1', () => {
    const x = parseXmlQueries(multi(2))!;
    const combined = `-- note\n${combineXmlStatements(x.statements).replace(/^-- ==== q1 ====\n/, '')}`;
    const sqls = splitXmlStatements(x.statements, combined);
    expect(sqls[0].startsWith('-- note\n')).toBe(true);
    expect(sqls[1]).toBe(x.statements[1]!.sql);
  });
  test('single statement unchanged', () => {
    const x = parseXmlQueries(one('SELECT 1'))!;
    expect(combineXmlStatements(x.statements)).toBe('SELECT 1');
  });
});
