import { describe, expect, test } from 'bun:test';
import { withAppearance, validAppearance } from './appearance.ts';
import { parseWindowsTerminalSchemes, SCHEME_COLORS, validSchemes, type ColorScheme } from './schemes.ts';
import { resolveThemeId, themeOf } from './themes.ts';

const wt = (name: string, extra: Record<string, string> = {}) => ({
  name,
  foreground: '#CCCCCC',
  background: '#0C0C0C',
  cursorColor: '#FFFFFF',
  selectionBackground: '#FFFFFF',
  ...Object.fromEntries(SCHEME_COLORS.map((k, i) => [k, `#${i.toString(16).padStart(2, '0')}0000`])),
  ...extra,
});

describe('parseWindowsTerminalSchemes', () => {
  test('a schemes array', () => {
    const out = parseWindowsTerminalSchemes(JSON.stringify([wt('Campbell'), wt('One Half Dark')]));
    expect(out.map((s) => s.id)).toEqual(['custom-campbell', 'custom-one-half-dark']);
    expect(out[0].foreground).toBe('#cccccc');
    expect(out[0].cursor).toBe('#ffffff');
    expect(out[0].purple).toBe('#050000');
  });

  test('a single scheme object', () => {
    expect(parseWindowsTerminalSchemes(JSON.stringify(wt('Solo'))).map((s) => s.name)).toEqual(['Solo']);
  });

  test('a whole settings.json with comments and trailing commas', () => {
    const json = `// settings
{
  "$schema": "https://aka.ms/terminal-profiles-schema", /* a URL in a string stays */
  "profiles": { "list": [], },
  "schemes": [ ${JSON.stringify(wt('Mine'))}, ],
}`;
    const out = parseWindowsTerminalSchemes(json);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Mine');
  });

  test('ids are unique against taken ones; bad entries are skipped', () => {
    const out = parseWindowsTerminalSchemes(JSON.stringify([wt('A'), wt('A'), { name: 'Broken', foreground: '#fff' }]), ['custom-a']);
    expect(out.map((s) => s.id)).toEqual(['custom-a-2', 'custom-a-3']);
    expect(parseWindowsTerminalSchemes('not json')).toEqual([]);
  });

  test('parsed schemes pass validation', () => {
    expect(validSchemes(parseWindowsTerminalSchemes(JSON.stringify([wt('X'), wt('Y')])))).not.toBeNull();
    expect(validSchemes([{ id: 'x', name: 'x', foreground: 'red' }])).toBeNull();
  });
});

describe('theme resolution', () => {
  const [scheme] = parseWindowsTerminalSchemes(JSON.stringify(wt('Custom'))) as [ColorScheme];
  const read = () => '';

  test('a custom scheme id gives its colors, purple as magenta', () => {
    const theme = themeOf(scheme.id, read, [scheme]);
    expect(theme.background).toBe('#0c0c0c');
    expect(theme.magenta).toBe('#050000');
    expect(theme.brightMagenta).toBe('#0d0000');
    expect(resolveThemeId(scheme.id, [scheme])).toBe(scheme.id);
  });

  test('presets resolve; unknown ids follow the app', () => {
    expect(themeOf('dracula', read, [scheme]).background).toBe('#282a36');
    expect(resolveThemeId('dracula')).toBe('dracula');
    expect(resolveThemeId('gone', [scheme])).toBe('app');
    expect(resolveThemeId(undefined)).toBe('app');
  });
});

describe('profile appearance', () => {
  test('validation uses the flat ranges', () => {
    expect(validAppearance({ fontSize: 14, theme: 'nord', padding: 0, cursorBlink: false })).not.toBeNull();
    expect(validAppearance({ fontSize: 40 })).toBeNull();
    expect(validAppearance({ padding: 49 })).toBeNull();
    expect(validAppearance({ lineHeight: 0.5 })).toBeNull();
    expect(validAppearance({ cursorStyle: 'beam' })).toBeNull();
    expect(validAppearance({ other: 1 })).toBeNull();
    expect(validAppearance([])).toBeNull();
  });

  test('set fields win over the global options', () => {
    const base = { fontSize: 13, theme: 'app', fontFamily: 'Mono', scrollback: 5000 };
    expect(withAppearance(base, { fontSize: 16, theme: 'nord', fontFamily: ' ' })).toEqual({ fontSize: 16, theme: 'nord', fontFamily: 'Mono', scrollback: 5000 });
    expect(withAppearance(base, undefined)).toBe(base);
  });
});
