import { expect, test } from 'bun:test';
import { parseRegTheme } from './theme.ts';

test('parseRegTheme reads the AppsUseLightTheme dword', () => {
  const out = '\r\nHKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\r\n    AppsUseLightTheme    REG_DWORD    0x0\r\n';
  expect(parseRegTheme(out)).toBe('dark');
  expect(parseRegTheme(out.replace('0x0', '0x1'))).toBe('light');
  expect(parseRegTheme('nothing')).toBeNull();
});
