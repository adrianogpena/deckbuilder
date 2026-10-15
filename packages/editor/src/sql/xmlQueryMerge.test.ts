import { describe, expect, test } from 'bun:test';
import { mergeXmlStatements, type XmlQueryStatement } from './xmlQuery';

const st = (sql: string, label = ''): XmlQueryStatement => ({ index: 0, name: label, setName: '', label, sql, from: 0, to: 0, cdata: true, prefix: '' });
const list = (...sqls: string[]) => sqls.map((s, i) => st(s, `q${i + 1}`));

describe('mergeXmlStatements', () => {
  test('inlines the earlier statement as scalar subquery', () => {
    const out = mergeXmlStatements(list('SELECT count(contract_id) as countcontract from contract', 'SELECT contract_id, reference from contract where rownum = {countcontract}'));
    expect(out).toBe('-- merged from: q1, q2\nSELECT contract_id, reference from contract where rownum = (SELECT countcontract FROM (SELECT count(contract_id) as countcontract from contract) WHERE ROWNUM = 1)');
  });

  test('chain of three resolves recursively', () => {
    const out = mergeXmlStatements(list('SELECT 1 a FROM dual', 'SELECT {a} + 1 AS b FROM dual', 'SELECT * FROM t WHERE x = {b}'));
    expect(out).toContain('(SELECT b FROM (SELECT (SELECT a FROM (SELECT 1 a FROM dual) WHERE ROWNUM = 1) + 1 AS b FROM dual) WHERE ROWNUM = 1)');
    expect(out).not.toContain('{');
  });

  test('unresolved names and numeric params stay', () => {
    const out = mergeXmlStatements(list('SELECT a FROM t WHERE id = {0}', 'SELECT * FROM u WHERE x = {zzz} AND y = {1} AND z = {A}'));
    expect(out).toContain('{zzz}');
    expect(out).toContain('{1}');
    expect(out).toContain('(SELECT A FROM (SELECT a FROM t WHERE id = {0}) WHERE ROWNUM = 1)');
  });

  test('trailing semicolon dropped and trailing comment wrapped safely', () => {
    const out = mergeXmlStatements(list('SELECT a FROM t;\n', 'SELECT {a} FROM dual'));
    expect(out).toContain('(SELECT a FROM (SELECT a FROM t) WHERE ROWNUM = 1)');
    const out2 = mergeXmlStatements(list('SELECT a FROM t -- note\n', 'SELECT {a} FROM dual'));
    expect(out2).toContain('(SELECT a FROM (SELECT a FROM t -- note\n) WHERE ROWNUM = 1)');
  });
});
