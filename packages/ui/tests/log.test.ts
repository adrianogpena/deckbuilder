import { describe, expect, test } from 'bun:test';
import {
  addBookmark,
  addHighlight,
  emptyTail,
  filterLines,
  firstLineAtOrAfter,
  levelCounts,
  lineIndexAt,
  levelOf,
  linesOf,
  matcher,
  matcherError,
  matchIndexes,
  MAX_BOOKMARKS,
  MAX_HIGHLIGHTS,
  MAX_LOG_FILES,
  nextHighlightColor,
  segments,
  tailReducer,
  validLogSettings,
  withMarkers,
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

describe('addHighlight', () => {
  test('adds trimmed terms in the next free color and ignores duplicates', () => {
    const one = addHighlight([], ' Foo ');
    expect(one).toEqual([{ text: 'Foo', color: 'accent' }]);
    expect(addHighlight(one, 'foo')).toBe(one);
    expect(addHighlight(one, '  ')).toBe(one);
    expect(addHighlight(one, 'bar')[1]).toEqual({ text: 'bar', color: 'ok' });
  });

  test('stops at the maximum', () => {
    const full = Array.from({ length: MAX_HIGHLIGHTS }, (_, i) => ({ text: `t${i}`, color: 'accent' as const }));
    expect(addHighlight(full, 'new')).toBe(full);
  });

  test('refuses text over the length cap', () => {
    expect(addHighlight([], 'a'.repeat(201))).toEqual([]);
    expect(addHighlight([], 'a'.repeat(200))).toHaveLength(1);
  });
});

describe('addBookmark', () => {
  test('drops the oldest beyond the maximum', () => {
    const list = Array.from({ length: MAX_BOOKMARKS }, (_, i) => ({ offset: i, label: `b${i}`, at: 100 + i, preview: '' }));
    list[3] = { ...list[3]!, at: 1 };
    const next = addBookmark(list, { offset: 999, label: 'new', at: 1000, preview: '' });
    expect(next).toHaveLength(MAX_BOOKMARKS);
    expect(next.some((b) => b.label === 'b3')).toBe(false);
    expect(next.at(-1)!.label).toBe('new');
  });
});

describe('withMarkers', () => {
  const lines = linesOf({ from: 100, to: 112, text: 'aaa\nbbb\nccc\n' }, 0, null);
  const bm = (offset: number, at = 0) => ({ offset, label: String(offset), at, preview: '' });

  test('returns the lines when no bookmark shows', () => {
    expect(withMarkers(lines, [], 100, 112)).toBe(lines);
    expect(withMarkers(lines, [bm(50), bm(200)], 100, 112)).toBe(lines);
  });

  test('puts markers above the first line at or after the offset, and at the end', () => {
    const rows = withMarkers(lines, [bm(112), bm(106), bm(102), bm(104)], 100, 112);
    expect(rows.map((r) => ('n' in r ? r.text : `#${r.offset}`))).toEqual(['aaa', '#102', '#104', 'bbb', '#106', 'ccc', '#112']);
  });
});

describe('validLogSettings', () => {
  const bm = (at: number, offset = 0) => ({ offset, label: 'x', at, preview: '' });
  const term = (text: string) => ({ text, color: 'accent' });

  test('is null for a wrong shape', () => {
    expect(validLogSettings(null)).toBeNull();
    expect(validLogSettings({ highlights: {}, bookmarks: {} })).toBeNull();
    expect(validLogSettings({ highlights: [], bookmarks: [] })).toBeNull();
  });

  test('drops an over-long highlight and keeps the others', () => {
    const out = validLogSettings({ highlights: [term('ok'), term('a'.repeat(201)), term('b')], bookmarks: {} });
    expect(out!.highlights.map((h) => h.text)).toEqual(['ok', 'b']);
  });

  test('keeps the newest files beyond the file limit', () => {
    const bookmarks = Object.fromEntries(Array.from({ length: MAX_LOG_FILES + 1 }, (_, i) => [`p:${i}`, [bm(i + 1)]]));
    const out = validLogSettings({ highlights: [], bookmarks });
    expect(Object.keys(out!.bookmarks)).toHaveLength(MAX_LOG_FILES);
    expect(out!.bookmarks['p:0']).toBeUndefined();
  });

  test('drops only a key over the length limit and invalid bookmarks', () => {
    const out = validLogSettings({ highlights: [], bookmarks: { ['k'.repeat(301)]: [bm(1)], ok: [bm(2), { offset: -1 }] } });
    expect(Object.keys(out!.bookmarks)).toEqual(['ok']);
    expect(out!.bookmarks.ok).toHaveLength(1);
  });
});

describe('lineIndexAt', () => {
  test('counts only line rows before the row', () => {
    const lines = linesOf({ from: 0, to: 12, text: 'aaa\nbbb\nccc\n' }, 0, null);
    const rows = withMarkers(lines, [{ offset: 0, label: 'a', at: 1, preview: '' }, { offset: 8, label: 'b', at: 2, preview: '' }], 0, 12);
    expect(rows.map((r) => ('n' in r ? 'L' : 'M')).join('')).toBe('MLLML');
    expect(lineIndexAt(rows, 0)).toBe(0);
    expect(lineIndexAt(rows, 2)).toBe(1);
    expect(lineIndexAt(rows, 4)).toBe(2);
    expect(lineIndexAt(rows, 5)).toBe(3);
  });
});
