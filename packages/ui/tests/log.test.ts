import { describe, expect, test } from 'bun:test';
import {
  emptyTail,
  filterLines,
  firstLineAtOrAfter,
  levelCounts,
  levelOf,
  linesOf,
  matcher,
  matcherError,
  matchIndexes,
  nextHighlightColor,
  segments,
  tailReducer,
  wordAt,
} from '../src/log.ts';

describe('levelOf', () => {
  test('reads log4j, logback and java.util.logging levels', () => {
    expect(levelOf('2026-01-01 10:00:00,123 ERROR [main] Foo - boom')).toBe('error');
    expect(levelOf('10:00:00.123 [main] WARN  c.a.Foo - careful')).toBe('warn');
    expect(levelOf('INFO: started')).toBe('info');
    expect(levelOf('SEVERE: failed')).toBe('error');
    expect(levelOf('FINE: details')).toBe('debug');
    expect(levelOf('FINEST: more')).toBe('trace');
    expect(levelOf('[TRACE] x')).toBe('trace');
  });

  test('reads key=value and JSON levels case-insensitively', () => {
    expect(levelOf('ts=1 level=warn msg=x')).toBe('warn');
    expect(levelOf('{"level":"Error","msg":"x"}')).toBe('error');
  });

  test('ignores lower-case words and embedded tokens', () => {
    expect(levelOf('an error occurred')).toBeNull();
    expect(levelOf('MYERROR happened')).toBeNull();
    expect(levelOf('')).toBeNull();
  });
});

describe('linesOf', () => {
  test('offsets equal byte positions, with CRLF and multi-byte characters', () => {
    const text = 'ERROR ação\r\nINFO 😀 ok\r\nlast\n';
    const bytes = Buffer.from(text);
    const lines = linesOf({ from: 100, to: 100 + bytes.length, text }, 0, null);
    expect(lines.map((l) => l.text)).toEqual(['ERROR ação', 'INFO 😀 ok', 'last']);
    expect(lines.map((l) => l.offset)).toEqual([
      100,
      100 + Buffer.byteLength('ERROR ação\r\n'),
      100 + Buffer.byteLength('ERROR ação\r\nINFO 😀 ok\r\n'),
    ]);
    expect(lines.map((l) => l.n)).toEqual([0, 1, 2]);
  });

  test('stack trace lines inherit the level', () => {
    const lines = linesOf({ from: 0, to: 0, text: 'ERROR boom\n\tat a.b(C.java:1)\nINFO ok\n' }, 0, null);
    expect(lines.map((l) => [l.level, l.own])).toEqual([
      ['error', true],
      ['error', false],
      ['info', true],
    ]);
    expect(linesOf({ from: 0, to: 0, text: 'plain\n' }, 5, 'warn')[0]).toMatchObject({ level: 'warn', own: false, n: 5 });
  });

  test('partial becomes a last line that does not consume a number', () => {
    const lines = linesOf({ from: 0, to: 4, text: 'a\nb\n', partial: 'ERR' }, 0, null);
    expect(lines.at(-1)).toMatchObject({ text: 'ERR', partial: true, n: 2, offset: 4 });
    expect(linesOf({ from: 0, to: 0, text: '' }, 0, null)).toEqual([]);
  });
});

describe('tailReducer', () => {
  test('appends, replaces the partial line, drops the oldest and resets', () => {
    let s = tailReducer(emptyTail(), { from: 0, to: 4, text: 'a\nb\n', partial: 'ER' });
    expect(s.lines.map((l) => l.text)).toEqual(['a', 'b', 'ER']);
    expect(s).toMatchObject({ end: 4, nextN: 2 });
    s = tailReducer(s, { from: 4, to: 14, text: 'ERROR x\nc\n', partial: 'd' });
    expect(s.lines.map((l) => [l.n, l.text])).toEqual([[0, 'a'], [1, 'b'], [2, 'ERROR x'], [3, 'c'], [4, 'd']]);
    expect(s.lines[3]!.level).toBe('error');
    expect(s.nextN).toBe(4);
    const capped = tailReducer(s, { from: 14, to: 18, text: 'e\nf\n' }, 3);
    expect(capped.lines.map((l) => l.text)).toEqual(['c', 'e', 'f']);
    const reset = tailReducer(capped, { from: 0, to: 0, text: '', reset: true });
    expect(reset).toMatchObject({ lines: [], end: 0, rotated: true, nextN: capped.nextN });
  });
});

describe('matcher', () => {
  test('escapes text, honors whole word, case and regex', () => {
    expect('a.b axb'.match(matcher({ text: 'a.b' })!)).toHaveLength(1);
    expect('foo foobar'.match(matcher({ text: 'foo', wholeWord: true })!)).toHaveLength(1);
    expect('Foo foo'.match(matcher({ text: 'foo' })!)).toHaveLength(2);
    expect('Foo foo'.match(matcher({ text: 'foo', caseSensitive: true })!)).toHaveLength(1);
    expect('a1 b22'.match(matcher({ text: '\\d+', regex: true })!)).toHaveLength(2);
  });

  test('null for empty text or an invalid regex', () => {
    expect(matcher({ text: '' })).toBeNull();
    expect(matcher({ text: '(', regex: true })).toBeNull();
    expect(matcherError({ text: '(', regex: true })).toBeTruthy();
    expect(matcherError({ text: 'x' })).toBeNull();
  });
});

describe('segments', () => {
  const join = (s: Array<{ text: string }>) => s.map((x) => x.text).join('');

  test('terms match case-insensitively, leftmost then longest, without overlap', () => {
    const text = 'Foobar foo';
    const out = segments(text, [{ text: 'foo', color: 'ok' }, { text: 'foobar', color: 'err' }], null);
    expect(join(out)).toBe(text);
    expect(out.filter((s) => s.term !== undefined).map((s) => [s.text, s.term])).toEqual([['Foobar', 1], ['foo', 0]]);
  });

  test('query hits win over terms and terms stay between hits', () => {
    const text = 'abc def abc';
    const out = segments(text, [{ text: 'bc d', color: 'ok' }, { text: 'def', color: 'err' }], matcher({ text: 'abc' }));
    expect(join(out)).toBe(text);
    expect(out.filter((s) => s.hit).map((s) => s.text)).toEqual(['abc', 'abc']);
    expect(out.filter((s) => s.term !== undefined).map((s) => [s.text, s.term])).toEqual([['def', 1]]);
  });
});

describe('filters and lookups', () => {
  const lines = linesOf({ from: 0, to: 0, text: 'ERROR a\n\ttrace\nINFO b\nplain\n' }, 0, null);

  test('filterLines and levelCounts', () => {
    expect(filterLines(lines, null)).toBe(lines);
    expect(filterLines(lines, new Set(['error'])).map((l) => l.text)).toEqual(['ERROR a', '\ttrace']);
    expect(levelCounts(lines)).toEqual({ error: 1, warn: 0, info: 1, debug: 0, trace: 0 });
    expect(filterLines(linesOf({ from: 0, to: 0, text: 'x\n' }, 0, null), new Set(['info']))).toEqual([]);
  });

  test('matchIndexes indexes into the given lines', () => {
    expect(matchIndexes(lines, matcher({ text: 'a' }))).toEqual([0, 1, 3]);
    expect(matchIndexes(lines, null)).toEqual([]);
  });

  test('firstLineAtOrAfter', () => {
    expect(firstLineAtOrAfter(lines, 0)).toBe(0);
    expect(firstLineAtOrAfter(lines, lines[2]!.offset)).toBe(2);
    expect(firstLineAtOrAfter(lines, lines[2]!.offset + 1)).toBe(3);
    expect(firstLineAtOrAfter(lines, 9999)).toBe(-1);
  });
});

describe('wordAt and nextHighlightColor', () => {
  test('wordAt takes the run around the index', () => {
    const text = 'at com.acme.Foo:42 (x)';
    expect(wordAt(text, 8)).toBe('com.acme.Foo:42');
    expect(wordAt('see foo.', 5)).toBe('foo');
    expect(wordAt(text, 2)).toBe('');
    expect(wordAt(text, 100)).toBe('');
  });

  test('nextHighlightColor picks the first unused color, then cycles', () => {
    expect(nextHighlightColor([])).toBe('accent');
    expect(nextHighlightColor([{ text: 'a', color: 'accent' }, { text: 'b', color: 'warn' }])).toBe('ok');
    const all = (['accent', 'ok', 'warn', 'err', 'info', 'debug'] as const).map((color) => ({ text: color, color }));
    expect(nextHighlightColor(all)).toBe('accent');
  });
});
