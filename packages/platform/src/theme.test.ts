import { expect, test } from 'bun:test';
import type { Runner } from './run.ts';
import { osThemeKind, parseRegTheme } from './theme.ts';

test('parseRegTheme reads the AppsUseLightTheme dword', () => {
  const out = String.raw`
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize
    AppsUseLightTheme    REG_DWORD    0x0
`;
  expect(parseRegTheme(out)).toBe('dark');
  expect(parseRegTheme(out.replace('0x0', '0x1'))).toBe('light');
  expect(parseRegTheme('nothing')).toBeNull();
});

test.skipIf(process.platform !== 'win32')('osThemeKind queries the Personalize key', async () => {
  let argv: string[] = [];
  const run = (async (cmd: string[]) => {
    argv = cmd;
    return { kind: 'done', code: 0, stdout: 'AppsUseLightTheme    REG_DWORD    0x0', stderr: '' };
  }) as unknown as Runner;
  expect(await osThemeKind(run)).toBe('dark');
  expect(argv).toContain(String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`);
});
