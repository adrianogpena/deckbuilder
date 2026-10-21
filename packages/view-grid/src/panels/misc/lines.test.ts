import { describe, expect, test } from 'bun:test';
import { isHttpUrl, parseLines } from './lines';

describe('parseLines', () => {
  test('parses label and url, skipping blanks and comments', () => {
    const text = 'GitHub | https://github.com\n\n# note\nDocs|https://example.com/a?b=1';
    expect(parseLines(text)).toEqual([
      { label: 'GitHub', url: 'https://github.com' },
      { label: 'Docs', url: 'https://example.com/a?b=1' },
    ]);
  });

  test('a bare url labels itself and non-http urls are dropped', () => {
    expect(parseLines('https://a.dev\nBad | javascript:alert(1)\nFile | file:///c:/x')).toEqual([{ label: 'https://a.dev', url: 'https://a.dev' }]);
  });

  test('respects max', () => {
    expect(parseLines('a | http://a.io\nb | http://b.io\nc | http://c.io', 2).map((i) => i.label)).toEqual(['a', 'b']);
  });

  test('isHttpUrl', () => {
    expect(isHttpUrl('http://x.io')).toBe(true);
    expect(isHttpUrl('ftp://x.io')).toBe(false);
    expect(isHttpUrl('nope')).toBe(false);
  });
});
