import { expect, test } from 'bun:test';
import { compareCells, delimiterOf, hexRows, parseDelimited, parseEnv } from '../src/table.ts';

test('parseDelimited handles quotes, doubled quotes, line breaks and CRLF', () => {
  expect(parseDelimited('a,b\r\n"x,1","he said ""hi"""\n"line\nbreak",z', ',')).toEqual([
    ['a', 'b'],
    ['x,1', 'he said "hi"'],
    ['line\nbreak', 'z'],
  ]);
});

test('parseDelimited keeps empty fields and a last line without a break', () => {
  expect(parseDelimited('a,,c\n,,', ',')).toEqual([['a', '', 'c'], ['', '', '']]);
  expect(parseDelimited('', ',')).toEqual([]);
});

test('delimiterOf', () => {
  expect(delimiterOf('a.tsv', 'a,b')).toBe('\t');
  expect(delimiterOf('a.csv', 'a;b;c\n1,2,3')).toBe(';');
  expect(delimiterOf('a.csv', 'a,b;c')).toBe(',');
});

test('compareCells sorts numbers as numbers and text naturally', () => {
  expect(['10', '9', '100'].sort(compareCells)).toEqual(['9', '10', '100']);
  expect(['b2', 'b10', 'a'].sort(compareCells)).toEqual(['a', 'b2', 'b10']);
});

test('parseEnv reads variables, quotes, export and comments', () => {
  const lines = parseEnv('# note\nA=1\nexport B="two words"\n\nC=\n');
  expect(lines.filter((l) => l.key).map((l) => [l.key, l.value])).toEqual([['A', '1'], ['B', 'two words'], ['C', '']]);
  expect(lines[0]!.key).toBeNull();
});

test('hexRows lays out 16 bytes per row', () => {
  const rows = hexRows(new Uint8Array([72, 105, 0, 255, ...Array(14).fill(65)]));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ offset: '00000000', ascii: 'Hi..AAAAAAAAAAAA' });
  expect(rows[0]!.hex.startsWith('48 69 00 ff ')).toBe(true);
  expect(rows[1]).toMatchObject({ offset: '00000010', ascii: 'AA' });
});
