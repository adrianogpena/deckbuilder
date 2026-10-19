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

/** Browsers a setting can name; anything else is taken as an executable path. */
export const NAMED_BROWSERS = ['edge', 'chrome', 'firefox'] as const;
export type NamedBrowser = (typeof NAMED_BROWSERS)[number];

const NAMED_WINDOWS: Record<NamedBrowser, { roots: string[]; rels: string[] }> = {
  edge: { roots: WINDOWS_ROOTS, rels: [WINDOWS_BROWSERS[0]!] },
  chrome: { roots: WINDOWS_ROOTS, rels: [WINDOWS_BROWSERS[1]!] },
  firefox: { roots: [...WINDOWS_ROOTS], rels: ['Mozilla Firefox\\firefox.exe', 'Microsoft\\WindowsApps\\firefox.exe'] },
};
const NAMED_MAC: Record<NamedBrowser, string> = {
  edge: MAC_BROWSERS[0]!,
  chrome: MAC_BROWSERS[1]!,
  firefox: '/Applications/Firefox.app/Contents/MacOS/firefox',
};
const NAMED_LINUX: Record<NamedBrowser, string[]> = {
  edge: ['microsoft-edge'],
  chrome: ['google-chrome', 'chromium', 'chromium-browser'],
  firefox: ['firefox'],
};

/**
 * Executable for a browser setting: a name from `NAMED_BROWSERS` is looked up in the usual install places,
 * any other text is a path that must exist. Null for a blank setting or a browser that is not found
 * (the caller then uses the system default).
 */
export function resolveBrowser(spec: string | undefined, opts: FindBrowserOptions = {}): string | null {
  const value = spec?.trim();
  if (!value) return null;
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  const name = value.toLowerCase() as NamedBrowser;
  if (!NAMED_BROWSERS.includes(name)) return exists(value) ? value : null;
  if (platform === 'win32') {
    const env = opts.env ?? process.env;
    const { roots, rels } = NAMED_WINDOWS[name];
    for (const rel of rels) {
      for (const root of roots) {
        const dir = env[root];
        if (!dir) continue;
        const path = win32.join(dir, rel);
        if (exists(path)) return path;
      }
    }
    return null;
  }
  if (platform === 'darwin') return exists(NAMED_MAC[name]) ? NAMED_MAC[name] : null;
  const which = opts.which ?? ((cmd: string) => Bun.which(cmd));
  for (const cmd of NAMED_LINUX[name]) {
    const path = which(cmd);
    if (path) return path;
  }
  return null;
}
