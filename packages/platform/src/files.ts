import { dirname, extname } from 'node:path';
import { PlatformError } from './errors.ts';

// Extensions Windows runs (or hands to a script host) instead of showing: opening one is running it.
const RUNNABLE = new Set(
  '.exe .bat .cmd .com .ps1 .psm1 .vbs .vbe .js .jse .wsf .wsh .msc .lnk .url .hta .msi .scr .cpl .jar .reg .application .appref-ms'.split(' '),
);

/** True when opening `path` with its default app would run it: a known runnable extension or one in %PATHEXT%. */
export function isRunnable(path: string): boolean {
  const ext = extname(path).toLowerCase();
  if (!ext) return false;
  if (RUNNABLE.has(ext)) return true;
  return (process.env.PATHEXT ?? '').toLowerCase().split(';').includes(ext);
}

// Not hidden: windowsHide starts explorer.exe with SW_HIDE and its window never appears.
function launch(argv: string[], windowsVerbatimArguments = false): void {
  Bun.spawn(argv, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, windowsVerbatimArguments }).unref();
}

/** Shows the absolute `path` selected in the OS file manager (Linux: opens its folder). */
export async function revealInFolder(path: string): Promise<void> {
  // explorer.exe parses its own command line; Windows paths can't contain `"`, so quoting is safe.
  if (process.platform === 'win32') launch(['explorer.exe', `/select,"${path}"`], true);
  else if (process.platform === 'darwin') launch(['open', '-R', path]);
  else launch(['xdg-open', dirname(path)]);
}

/**
 * Opens the absolute `path` with the OS default app. Rejects with PlatformError 'openRefused' for
 * runnable files (`isRunnable`): the app shows files, it never runs them.
 */
export async function openWithDefault(path: string): Promise<void> {
  if (isRunnable(path)) throw new PlatformError('openRefused', 'This file type is not opened from the app.', path);
  if (process.platform === 'win32') launch(['explorer.exe', path]);
  else if (process.platform === 'darwin') launch(['open', path]);
  else launch(['xdg-open', path]);
}
