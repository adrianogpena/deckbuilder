import { describe, expect, test } from 'bun:test';
import { formatTabTitle, parseOsc133, parseOsc7 } from './shell-integration.ts';
import { themeOf } from './themes.ts';

describe('parseOsc133', () => {
  test('marks', () => {
    expect(parseOsc133('A')).toEqual({ kind: 'A' });
    expect(parseOsc133('B')).toEqual({ kind: 'B' });
    expect(parseOsc133('C')).toEqual({ kind: 'C' });
    expect(parseOsc133('D;0')).toEqual({ kind: 'D', code: 0 });
    expect(parseOsc133('D;127')).toEqual({ kind: 'D', code: 127 });
    expect(parseOsc133('D')).toEqual({ kind: 'D', code: null });
    expect(parseOsc133('D;x')).toEqual({ kind: 'D', code: null });
    expect(parseOsc133('P;k=v')).toBeNull();
  });
});

describe('parseOsc7', () => {
  test('paths', () => {
    expect(parseOsc7('file://host/home/me/a%20b')).toBe('/home/me/a b');
    expect(parseOsc7('file:///C:/Users/me')).toBe('C:/Users/me');
    expect(parseOsc7('file://pc/c/Users')).toBe('/c/Users');
    expect(parseOsc7('/home/me')).toBeNull();
  });
});

describe('formatTabTitle', () => {
  const vars = { name: 'bash', shell: 'Git Bash', folder: 'src', cwd: '/x/src', title: '' };
  test('fills placeholders', () => {
    expect(formatTabTitle('{name}', vars)).toBe('bash');
    expect(formatTabTitle('{name} {folder} {cwd}', vars)).toBe('bash src /x/src');
    expect(formatTabTitle('{title} {shell}', vars)).toBe('Git Bash');
    expect(formatTabTitle('{other} {name}', vars)).toBe('{other} bash');
    expect(formatTabTitle('{title}', {})).toBe('');
  });
});

describe('themeOf', () => {
  test('app reads tokens, presets are fixed', () => {
    const read = (token: string) => (token === '--text' ? '#123456' : '');
    expect(themeOf('app', read).foreground).toBe('#123456');
    expect(themeOf('unknown', read).foreground).toBe('#123456');
    const nord = themeOf('nord', read);
    expect(nord.background).toBe('#2e3440');
    expect(nord.brightWhite).toBe('#eceff4');
    expect(nord.cursorAccent).toBe('#2e3440');
  });
});
