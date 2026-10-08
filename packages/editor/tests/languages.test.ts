import { describe, expect, test } from 'bun:test';
import { langOfFile, parserOf, previewKind } from '../src/languages.ts';

describe('langOfFile', () => {
  test('maps extensions case-insensitively', () => {
    expect(langOfFile('a.curl')).toBe('shell');
    expect(langOfFile('run.sh')).toBe('shell');
    expect(langOfFile('README.MD')).toBe('markdown');
    expect(langOfFile('q.sql')).toBe('sql');
    expect(langOfFile('data.json')).toBe('json');
  });

  test('falls back to text', () => {
    expect(langOfFile('x.bin')).toBe('text');
    expect(langOfFile('Makefile')).toBe('text');
  });
});

describe('previewKind', () => {
  test('sorts files into preview kinds', () => {
    expect(previewKind('notes.markdown')).toBe('markdown');
    expect(previewKind('a.json')).toBe('json');
    expect(previewKind('req.http')).toBe('code');
    expect(previewKind('logo.SVG')).toBe('image');
    expect(previewKind('a.txt')).toBe('text');
  });
});

describe('parserOf', () => {
  test('gives parsers for highlighted languages only', () => {
    expect(parserOf('sql')).not.toBeNull();
    expect(parserOf('json')).not.toBeNull();
    expect(parserOf('shell')).not.toBeNull();
    expect(parserOf('text')).toBeNull();
  });
});
