import { describe, expect, test } from 'bun:test';
import { fenceName, highlightable, highlightRanges, MAX_HIGHLIGHT, pickerValue, resolveLang } from '../src/rich/codeBlock.ts';

describe('resolveLang', () => {
  test('ids, aliases and extensions', () => {
    expect(resolveLang('typescript')).toBe('typescript');
    expect(resolveLang('ts')).toBe('typescript');
    expect(resolveLang('TSX')).toBe('typescript');
    expect(resolveLang('js')).toBe('javascript');
    expect(resolveLang('py')).toBe('python');
    expect(resolveLang('bash')).toBe('shell');
    expect(resolveLang('zsh')).toBe('shell');
    expect(resolveLang('yml')).toBe('yaml');
    expect(resolveLang('c#')).toBe('csharp');
    expect(resolveLang('c++')).toBe('cpp');
    expect(resolveLang('golang')).toBe('go');
  });

  test('reads the first word of the info string', () => {
    expect(fenceName('  Sql title="q"')).toBe('sql');
    expect(resolveLang('sql title="q"')).toBe('sql');
  });

  test('unknown or empty is null', () => {
    expect(resolveLang('')).toBeNull();
    expect(resolveLang(null)).toBeNull();
    expect(resolveLang('cobol')).toBeNull();
    expect(resolveLang('mermaid')).toBeNull();
  });
});

describe('highlighting', () => {
  test('size threshold', () => {
    expect(highlightable('sql', MAX_HIGHLIGHT)).toBe(true);
    expect(highlightable('sql', MAX_HIGHLIGHT + 1)).toBe(false);
    expect(highlightable(null, 10)).toBe(false);
    expect(highlightable('markdown', 10)).toBe(false);
  });

  test('ranges for a known language, none for unknown or long blocks', () => {
    const ranges = highlightRanges('sql', 'SELECT 1');
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0]!.from).toBe(0);
    expect(highlightRanges('cobol', 'SELECT 1')).toEqual([]);
    expect(highlightRanges('sql', 'x'.repeat(MAX_HIGHLIGHT + 1))).toEqual([]);
  });
});

describe('pickerValue', () => {
  test('canonical language, mermaid, plain text or the raw name', () => {
    expect(pickerValue('ts')).toBe('typescript');
    expect(pickerValue('mermaid')).toBe('mermaid');
    expect(pickerValue('')).toBe('text');
    expect(pickerValue('cobol')).toBe('cobol');
  });
});
