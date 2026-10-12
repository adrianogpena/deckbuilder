import { describe, expect, test } from 'bun:test';
import { splitStatements, statementAt } from '../src/sql/statements.ts';

const texts = (s: string) => splitStatements(s).map((x) => x.text);

describe('splitStatements', () => {
  test('splits on semicolons and strips them', () => {
    expect(texts('select 1 from dual;\nselect 2 from dual;')).toEqual(['select 1 from dual', 'select 2 from dual']);
  });

  test('ignores semicolons in strings and comments', () => {
    expect(texts("select 'a;b' from dual; select 2 -- x;y\n from dual; /* ; */ select 3")).toEqual([
      "select 'a;b' from dual",
      'select 2 -- x;y\n from dual',
      '/* ; */ select 3',
    ]);
  });

  test('ignores semicolons in q-quotes', () => {
    expect(texts("select q'[a;b]' from dual; select q'!c;d!' from dual;")).toEqual([
      "select q'[a;b]' from dual",
      "select q'!c;d!' from dual",
    ]);
  });

  test('keeps an anonymous block whole until the slash line', () => {
    const s = 'begin\n  a := 1;\n  b := 2;\nend;\n/\nselect 1 from dual;';
    expect(texts(s)).toEqual(['begin\n  a := 1;\n  b := 2;\nend;', 'select 1 from dual']);
    expect(texts('declare x number; begin x := 1; end;')).toEqual(['declare x number; begin x := 1; end;']);
  });

  test('keeps a package body whole', () => {
    const s = 'create or replace package body pkg as\n  procedure p is begin null; end;\nend pkg;\n/\nselect 1 from dual';
    expect(texts(s)).toEqual([
      'create or replace package body pkg as\n  procedure p is begin null; end;\nend pkg;',
      'select 1 from dual',
    ]);
    expect(texts('create or replace editionable function f return number is begin return 1; end;\n/')).toEqual([
      'create or replace editionable function f return number is begin return 1; end;',
    ]);
    expect(texts('create type body t as member function f return number is begin return 1; end; end;\n/')).toHaveLength(1);
  });

  test('treats create table and create type as plain sql', () => {
    expect(texts('create table t (a number);\ncreate type ty as object (a number);')).toEqual([
      'create table t (a number)',
      'create type ty as object (a number)',
    ]);
  });

  test('splits a mixed script and reports trimmed offsets', () => {
    const s = "-- setup\nselect 'x;' from dual;\n\nbegin\n  null;\nend;\n/\n\nupdate t set a = 1;\n";
    const parts = splitStatements(s);
    expect(parts.map((p) => p.text)).toEqual([
      "-- setup\nselect 'x;' from dual",
      'begin\n  null;\nend;',
      'update t set a = 1',
    ]);
    for (const p of parts) expect(s.slice(p.from, p.to)).toBe(p.text);
  });

  test('swallows the rest of the script after a procedure without a slash', () => {
    expect(texts('create procedure p is begin null; end;\nselect 1 from dual;')).toHaveLength(1);
  });

  test('handles empty and comment-only text', () => {
    expect(splitStatements('')).toEqual([]);
    expect(splitStatements('  -- nothing\n')).toEqual([]);
  });
});

describe('statementAt', () => {
  const s = 'select 1 from dual;\n\nselect 2 from dual;';

  test('returns the statement containing the offset', () => {
    expect(statementAt(s, 3)?.text).toBe('select 1 from dual');
    expect(statementAt(s, s.length)?.text).toBe('select 2 from dual');
  });

  test('returns the previous statement on a blank line between statements', () => {
    expect(statementAt(s, 20)?.text).toBe('select 1 from dual');
  });

  test('returns the first statement before it and nothing for empty text', () => {
    expect(statementAt('\n\nselect 1', 0)?.text).toBe('select 1');
    expect(statementAt('', 0)).toBeUndefined();
  });
});
