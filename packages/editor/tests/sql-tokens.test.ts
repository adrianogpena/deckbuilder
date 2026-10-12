import { describe, expect, test } from 'bun:test';
import { SQL_KEYWORDS, tokenize } from '../src/sql/tokens.ts';

const kinds = (text: string) => tokenize(text).filter((t) => t.kind !== 'whitespace').map((t) => [t.kind, t.text]);

describe('tokenize', () => {
  test('covers the text contiguously', () => {
    const text = "select a, \"B c\" from t -- x\r\nwhere n = :id and s = 'it''s' /* c */\n/\nq'[a]'";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    tokens.forEach((t, i) => {
      expect(t.from).toBe(i === 0 ? 0 : tokens[i - 1]!.to);
      expect(text.slice(t.from, t.to)).toBe(t.text);
    });
  });

  test('classifies basic tokens', () => {
    expect(kinds('select x1 from "T" where a >= 1.5e3 and b = :p')).toEqual([
      ['keyword', 'select'],
      ['identifier', 'x1'],
      ['keyword', 'from'],
      ['quotedIdentifier', '"T"'],
      ['keyword', 'where'],
      ['identifier', 'a'],
      ['operator', '>='],
      ['number', '1.5e3'],
      ['keyword', 'and'],
      ['identifier', 'b'],
      ['operator', '='],
      ['bind', ':p'],
    ]);
    expect(SQL_KEYWORDS.has('select')).toBe(true);
  });

  test('handles strings with doubled quotes', () => {
    expect(kinds("'it''s;'")).toEqual([['string', "'it''s;'"]]);
  });

  test('handles q-quotes with every delimiter kind', () => {
    for (const [o, c] of [['[', ']'], ['{', '}'], ['(', ')'], ['<', '>'], ['!', '!'], ['#', '#']]) {
      const s = `q'${o}it's;${c}'`;
      expect(kinds(s)).toEqual([['qquote', s]]);
    }
    expect(kinds("Q'[a]' b")[0]).toEqual(['qquote', "Q'[a]'"]);
  });

  test('handles comments', () => {
    expect(kinds('a -- c;\nb /* x\n; */ c')).toEqual([
      ['identifier', 'a'],
      ['lineComment', '-- c;'],
      ['newline', '\n'],
      ['identifier', 'b'],
      ['blockComment', '/* x\n; */'],
      ['identifier', 'c'],
    ]);
  });

  test('recognizes a lone slash line only', () => {
    expect(kinds('a\n/\nb')[2]).toEqual(['slash', '/']);
    expect(kinds('a / b')[1]).toEqual(['operator', '/']);
    expect(kinds('  /  \n')[0]).toEqual(['slash', '/']);
  });

  test('never throws and runs unterminated tokens to the end', () => {
    for (const s of ["'abc", '"abc', '/* abc', "q'[abc", "q'", 'x -- abc', ':', '\u0001']) {
      expect(tokenize(s).map((t) => t.text).join('')).toBe(s);
    }
    expect(kinds("'abc;")).toEqual([['string', "'abc;"]]);
    expect(kinds('/* abc;')).toEqual([['blockComment', '/* abc;']]);
  });
});
