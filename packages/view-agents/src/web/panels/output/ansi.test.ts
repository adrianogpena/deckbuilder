import { describe, expect, test } from 'bun:test';
import { lineText, parseLines, splitHits, stripAnsi } from './ansi';

describe('parseLines', () => {
  test('maps SGR colors to classes and resets', () => {
    const [line] = parseLines('a\u001b[31;1mred\u001b[0mb');
    expect(line).toEqual([{ text: 'a', cls: '' }, { text: 'red', cls: 'ansi-fg-1 ansi-bold' }, { text: 'b', cls: '' }]);
  });

  test('keeps markup as text, splits lines and drops other escapes', () => {
    const lines = parseLines('<b>x</b>\u001b[2K\r\nsecond\u001b[92mok');
    expect(lineText(lines[0]!)).toBe('<b>x</b>');
    expect(lines[1]).toEqual([{ text: 'second', cls: '' }, { text: 'ok', cls: 'ansi-fg-10' }]);
  });

  test('a carriage return keeps the last write of the line', () => {
    expect(lineText(parseLines('10%\r50%\r100%')[0]!)).toBe('100%');
  });

  test('stripAnsi and splitHits', () => {
    expect(stripAnsi('\u001b[31mx\u001b[0m')).toBe('x');
    expect(splitHits('Foo foo', 'foo')).toEqual([{ text: 'Foo', hit: true }, { text: ' ', hit: false }, { text: 'foo', hit: true }]);
  });
});
