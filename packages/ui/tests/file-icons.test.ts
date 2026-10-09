import { describe, expect, test } from 'bun:test';
import { fileIconOf, folderIconOf } from '../src/file-icons';

describe('fileIconOf', () => {
  test.each([
    ['a.sql', 'database', 'info'],
    ['a.pkb', 'database', 'info'],
    ['a.json', 'braces', 'warn'],
    ['a.md', 'markdown', 'info'],
    ['a.log', 'log-file', 'ok'],
    ['a.http', 'curl', 'ok'],
    ['a.png', 'image', 'info'],
    ['a.svg', 'vector', 'warn'],
    ['a.pdf', 'pdf', 'err'],
    ['a.mp4', 'video', 'info'],
    ['a.mp3', 'audio', 'info'],
    ['a.docx', 'document', 'info'],
    ['a.pptx', 'slides', 'warn'],
    ['a.woff2', 'font', 'muted'],
    ['a.exe', 'app', 'muted'],
    ['a.csv', 'table', 'ok'],
    ['a.ts', 'code', undefined],
    ['a.ps1', 'terminal', undefined],
    ['a.zip', 'archive', undefined],
    ['a.pem', 'key', 'err'],
    ['a.yaml', 'settings-file', undefined],
    ['a.txt', 'file-text', undefined],
    ['a.unknown', 'file', undefined],
    ['noext', 'file', undefined],
  ])('%s', (name, icon, tone) => {
    expect(fileIconOf(name)).toEqual({ icon, tone } as never);
  });

  test('case insensitive', () => {
    expect(fileIconOf('QUERY.SQL').icon).toBe('database');
  });

  test('whole names', () => {
    expect(fileIconOf('.env').icon).toBe('settings-file');
    expect(fileIconOf('.env.local').icon).toBe('settings-file');
    expect(fileIconOf('Dockerfile').icon).toBe('settings-file');
    expect(fileIconOf('.gitignore').icon).toBe('settings-file');
  });
});

describe('folderIconOf', () => {
  test.each([
    ['sql', 'folder-database'],
    ['requests', 'folder-send'],
    ['Logs', 'folder-log'],
    ['docs', 'folder-docs'],
    ['__tests__', 'folder-test'],
    ['src', 'folder-code'],
    ['.vscode', 'folder-config'],
    ['images', 'folder-image'],
    ['scripts', 'folder-terminal'],
    ['.git', 'folder-git'],
    ['node_modules', 'folder-build'],
    ['other', 'folder'],
  ])('%s', (name, icon) => {
    expect(folderIconOf(name)).toBe(icon as never);
  });

  test('by content', () => {
    expect(folderIconOf('x', ['a.sql', 'b.sql', 'c.sql'])).toBe('folder-database');
  });

  test('mixed content stays a plain folder', () => {
    expect(folderIconOf('x', ['a.sql', 'b.json'])).toBe('folder');
  });

  test('a single file does not count', () => {
    expect(folderIconOf('x', ['a.sql'])).toBe('folder');
  });

  test('name wins over content', () => {
    expect(folderIconOf('logs', ['a.sql', 'b.sql'])).toBe('folder-log');
  });
});
