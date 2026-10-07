import type { Subprocess } from 'bun';
import { appBrowserArgv } from '@deckbuilder/platform';
import { DEFAULT_WINDOW, type WindowOptions } from './window.ts';

export interface AppWindowOptions {
  /** Edge or Chrome, from `findAppBrowser()`. */
  browser: string;
  /** Browser profile of the app; one profile means one browser process for all app windows. */
  profileDir: string;
  window?: WindowOptions;
  /** A launch became the browser's main process: its exit will report "all closed". */
  onMainStarted?: () => void;
  /** A launch handed its window to a browser process that isn't tracked (e.g. left over from a crash). */
  onUntracked?: () => void;
}

// A launch that stays up this long is the browser's main process; one that exits sooner handed
// its window to a browser process already running on the same profile.
const MAIN_AFTER_MS = 3000;

let main: Subprocess | null = null;
let pending = 0;

/** True while the tracked browser process runs or a launch hasn't settled yet. */
export function appWindowsOpen(): boolean {
  return main !== null || pending > 0;
}

/**
 * Opens `url` in an Edge/Chrome app window. `onAllClosed` runs when the main browser process
 * exits, which means every app window of the profile is closed.
 */
export function openAppWindow(url: string, opts: AppWindowOptions, onAllClosed: () => void): void {
  const size = { width: opts.window?.width ?? DEFAULT_WINDOW.width, height: opts.window?.height ?? DEFAULT_WINDOW.height };
  const proc = Bun.spawn(appBrowserArgv(opts.browser, url, opts.profileDir, size), { stdio: ['ignore', 'ignore', 'ignore'] });
  pending++;
  let settled = false;
  const settle = () => {
    if (settled) return false;
    settled = true;
    pending--;
    return true;
  };
  const timer = setTimeout(() => {
    if (!settle() || main) return;
    main = proc;
    opts.onMainStarted?.();
  }, MAIN_AFTER_MS);
  void proc.exited.then(() => {
    clearTimeout(timer);
    if (proc === main) {
      main = null;
      onAllClosed();
    } else if (settle() && !main) opts.onUntracked?.();
  });
}

/** Closes the tracked browser process gracefully, so its profile isn't marked as crashed. */
export function closeAppWindows(): void {
  if (!main) return;
  if (process.platform === 'win32') {
    Bun.spawn(['taskkill', '/PID', String(main.pid)], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  } else main.kill('SIGTERM');
  main = null;
}
