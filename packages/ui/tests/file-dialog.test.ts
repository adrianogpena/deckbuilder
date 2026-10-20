import { expect, test } from 'bun:test';
import { isAbsolutePath, isValidFileName, joinPath, matchesPatterns, parentPath, splitPath, withFilterExtension } from '../src/file-dialog.ts';

test('splits Windows, UNC and POSIX paths into breadcrumb segments', () => {
  expect(splitPath('C:\\Users\\me')).toEqual([
    { label: 'C:\\', path: 'C:\\' },
    { label: 'Users', path: 'C:\\Users' },
    { label: 'me', path: 'C:\\Users\\me' },
  ]);
  expect(splitPath('C:\\')).toEqual([{ label: 'C:\\', path: 'C:\\' }]);
  expect(splitPath('\\\\srv\\share\\a')).toEqual([
    { label: '\\\\srv\\share', path: '\\\\srv\\share' },
    { label: 'a', path: '\\\\srv\\share\\a' },
  ]);
  expect(splitPath('/home/me').map((s) => s.path)).toEqual(['/', '/home', '/home/me']);
  expect(splitPath('relative')).toEqual([]);
});

test('joins and finds the parent', () => {
  expect(joinPath('C:\\a', 'b')).toBe('C:\\a\\b');
  expect(joinPath('C:\\', 'b')).toBe('C:\\b');
  expect(joinPath('/a', 'b')).toBe('/a/b');
  expect(joinPath('/', 'b')).toBe('/b');
  expect(parentPath('C:\\a\\b')).toBe('C:\\a');
  expect(parentPath('C:\\a')).toBe('C:\\');
  expect(parentPath('C:\\')).toBeNull();
  expect(parentPath('/a')).toBe('/');
  expect(parentPath('/')).toBeNull();
});

test('recognizes absolute paths', () => {
  expect(isAbsolutePath('C:\\x')).toBe(true);
  expect(isAbsolutePath('\\\\s\\share')).toBe(true);
  expect(isAbsolutePath('/x')).toBe(true);
  expect(isAbsolutePath('x.md')).toBe(false);
});

test('matches filter patterns case-insensitively', () => {
  expect(matchesPatterns('Notes.MD', ['*.md'])).toBe(true);
  expect(matchesPatterns('notes.txt', ['*.md', '*.markdown'])).toBe(false);
  expect(matchesPatterns('anything', ['*.*'])).toBe(true);
  expect(matchesPatterns('anything', [])).toBe(true);
  expect(matchesPatterns('a.tar.gz', ['*.gz'])).toBe(true);
});

test('adds the filter extension only to a name without one', () => {
  const md = { name: 'Markdown', patterns: ['*.md'] };
  expect(withFilterExtension('notes', md)).toBe('notes.md');
  expect(withFilterExtension('notes.txt', md)).toBe('notes.txt');
  expect(withFilterExtension('notes', { name: 'All', patterns: ['*.*'] })).toBe('notes');
  expect(withFilterExtension('notes', undefined)).toBe('notes');
});

test('validates names', () => {
  expect(isValidFileName('ok name.md')).toBe(true);
  expect(isValidFileName('')).toBe(false);
  expect(isValidFileName('..')).toBe(false);
  expect(isValidFileName('a/b')).toBe(false);
  expect(isValidFileName('a:b')).toBe(false);
  expect(isValidFileName('a?')).toBe(false);
});
