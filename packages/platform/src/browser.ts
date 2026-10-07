import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

export interface FindBrowserOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  which?: (cmd: string) => string | null;
}

const WINDOWS_BROWSERS = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe'];
const WINDOWS_ROOTS = ['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA'];
const LINUX_BROWSERS = ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser'];
const MAC_BROWSERS = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

/** The Chromium browser that can open an app window (`--app=<url>`): Edge first, then Chrome. Null when none is installed. */
export function findAppBrowser(opts: FindBrowserOptions = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  if (platform === 'win32') {
    const env = opts.env ?? process.env;
    for (const browser of WINDOWS_BROWSERS) {
      for (const root of WINDOWS_ROOTS) {
        const dir = env[root];
        if (!dir) continue;
        const path = win32.join(dir, browser);
        if (exists(path)) return path;
      }
    }
    return null;
  }
  if (platform === 'darwin') return MAC_BROWSERS.find(exists) ?? null;
  const which = opts.which ?? ((cmd: string) => Bun.which(cmd));
  for (const cmd of LINUX_BROWSERS) {
    const path = which(cmd);
    if (path) return path;
  }
  return null;
}

/** Command line for an app window. Its own `profileDir` gives the app a browser process apart from the user's browser. */
export function appBrowserArgv(browser: string, url: string, profileDir: string, size: { width: number; height: number }): string[] {
  return [
    browser,
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${size.width},${size.height}`,
  ];
}
