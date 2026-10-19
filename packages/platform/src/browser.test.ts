import { expect, test } from 'bun:test';
import { appBrowserArgv, findAppBrowser, resolveBrowser } from './browser.ts';

const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
const EDGE = 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

const windows = (installed: string[]) => findAppBrowser({ platform: 'win32', env, exists: (p) => installed.includes(p) });

test('Edge is preferred over Chrome', () => {
  expect(windows([CHROME, EDGE])).toBe(EDGE);
});

test('Chrome is used when Edge is missing', () => {
  expect(windows([CHROME])).toBe(CHROME);
});

test('no Chromium browser gives null', () => {
  expect(windows([])).toBeNull();
  expect(findAppBrowser({ platform: 'linux', which: () => null })).toBeNull();
  expect(findAppBrowser({ platform: 'darwin', exists: () => false })).toBeNull();
});

test('Linux takes the first browser on PATH in order', () => {
  const onPath: Record<string, string> = { chromium: '/usr/bin/chromium', 'google-chrome': '/usr/bin/google-chrome' };
  expect(findAppBrowser({ platform: 'linux', which: (cmd) => onPath[cmd] ?? null })).toBe('/usr/bin/google-chrome');
});

test('macOS looks in /Applications', () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  expect(findAppBrowser({ platform: 'darwin', exists: (p) => p === chrome })).toBe(chrome);
});

test('argv opens an app window with its own profile', () => {
  expect(appBrowserArgv(EDGE, 'http://127.0.0.1:1/?t=x', 'C:\\home\\app-profile', { width: 1280, height: 820 })).toEqual([
    EDGE,
    '--app=http://127.0.0.1:1/?t=x',
    '--user-data-dir=C:\\home\\app-profile',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,820',
  ]);
});

test('resolveBrowser maps a name to its install and a path to itself', () => {
  const store = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\firefox.exe';
  const win = (spec: string, installed: string[]) => resolveBrowser(spec, { platform: 'win32', env, exists: (p) => installed.includes(p) });
  expect(win('Edge', [EDGE, CHROME])).toBe(EDGE);
  expect(win('chrome', [EDGE, CHROME])).toBe(CHROME);
  expect(win('firefox', [store])).toBe(store);
  expect(win('firefox', [])).toBeNull();
  expect(win('D:\\b\\brave.exe', ['D:\\b\\brave.exe'])).toBe('D:\\b\\brave.exe');
  expect(win('D:\\b\\gone.exe', [])).toBeNull();
  expect(win('  ', [EDGE])).toBeNull();
  expect(resolveBrowser(undefined)).toBeNull();
});
