import { type Runner, runWithTimeout } from './run.ts';

const PERSONALIZE = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`;
const TIMEOUT_MS = 5_000;

/** The light/dark value in `reg.exe query <Personalize> /v AppsUseLightTheme` output. */
export function parseRegTheme(stdout: string): 'dark' | 'light' | null {
  const m = stdout.match(/AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i);
  if (!m) return null;
  return parseInt(m[1]!, 16) === 0 ? 'dark' : 'light';
}

/** The OS app theme (Windows registry, macOS defaults), or null where there is no such setting. */
export async function osThemeKind(run: Runner = runWithTimeout): Promise<'dark' | 'light' | null> {
  if (process.platform === 'win32') {
    const r = await run(['reg.exe', 'query', PERSONALIZE, '/v', 'AppsUseLightTheme'], TIMEOUT_MS);
    return r.kind === 'done' && r.code === 0 ? parseRegTheme(r.stdout) : null;
  }
  if (process.platform === 'darwin') {
    // Prints "Dark" in dark mode; fails (no such key) in light mode.
    const r = await run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], TIMEOUT_MS);
    return r.kind === 'done' && r.code === 0 && /dark/i.test(r.stdout) ? 'dark' : 'light';
  }
  return null;
}
