import { describe, expect, test } from 'bun:test';
import { type CopyColumn, formatCopy, sqlLiteral, tableOf } from './copy-format';

type Row = unknown[];
const cols: CopyColumn<Row>[] = [
  { label: 'id', text: (r) => String(r[0]), raw: (r) => r[0], type: 'number' },
  { label: 'name', text: (r) => String(r[1] ?? ''), raw: (r) => r[1], type: 'text' },
];
const rows: Row[] = [
  ['1', "O'Neil | a\nb"],
  ['2', null],
];

describe('formatCopy', () => {
  test('tsv', () => {
    expect(formatCopy('tsv', cols, rows)).toBe("id\tname\n1\tO'Neil | a b\n2\t");
  });
  test('csv quotes commas, quotes and newlines', () => {
    expect(formatCopy('csv', cols, [['1', 'a,"b"\nc']])).toBe('id,name\r\n1,"a,""b""\nc"');
  });
  test('markdown escapes pipes and newlines', () => {
    expect(formatCopy('markdown', cols, rows)).toBe("| id | name |\n| --- | --- |\n| 1 | O'Neil \\| a<br>b |\n| 2 |  |");
  });
  test('json keeps null and raw values', () => {
    expect(JSON.parse(formatCopy('json', cols, rows))).toEqual([{ id: '1', name: "O'Neil | a\nb" }, { id: '2', name: null }]);
    expect(formatCopy('json', cols, rows)).toContain('\n  {\n    "id"');
  });
  test('insert quotes, doubles quotes, NULL and numbers', () => {
    expect(formatCopy('insert', cols, rows, 'select * from HR.EMP where x = 1')).toBe(
      "INSERT INTO HR.EMP (id, name) VALUES (1, 'O''Neil | a\nb');\nINSERT INTO HR.EMP (id, name) VALUES (2, NULL);",
    );
  });
});

describe('sqlLiteral', () => {
  test('number column with non-numeric text is quoted', () => {
    expect(sqlLiteral('abc', 'number')).toBe("'abc'");
    expect(sqlLiteral('12', 'text')).toBe("'12'");
    expect(sqlLiteral('12', undefined)).toBe("'12'");
    expect(sqlLiteral(null, 'number')).toBe('NULL');
  });
});

describe('tableOf', () => {
  test('simple select', () => {
    expect(tableOf('select a, b from emp')).toBe('emp');
    expect(tableOf('SELECT * FROM hr.emp WHERE a=1;')).toBe('hr.emp');
    expect(tableOf('select * from "My Tab"')).toBe('"My Tab"');
  });
  test('fallback', () => {
    expect(tableOf(undefined)).toBe('table_name');
    expect(tableOf('update x set a=1')).toBe('table_name');
  });
});
