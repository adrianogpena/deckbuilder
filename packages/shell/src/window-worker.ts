// One native window per Worker: Webview.run() blocks this thread until the window closes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getWindowPlacement, openExternal, parsePlacement, setWindowIconFromExe, setWindowPlacement, showWindow, type WindowPlacement } from '@kedalion/platform';
import type { Pointer } from 'bun:ffi';
import { SizeHint, Webview } from 'webview-bun';
import { setWebviewZoom } from './webview-zoom.ts';
import type { WindowRequest } from './window.ts';

declare const self: Worker;

function readPlacement(file: string): WindowPlacement | undefined {
  try {
    return parsePlacement(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

// Runs before every page load. Tells the UI it is in a window, sends links to other origins to
// the default browser instead of navigating the app window away, and stops Ctrl+wheel and
// Ctrl +/-/0 from zooming the whole window (the zoom is a setting; the page still gets the events).
const initScript = (popout?: string): string => `
window.__KEDALION_SHELL__ = 'window';
${popout ? `window.__KEDALION_POPOUT__ = ${JSON.stringify(popout)};` : ''}
(() => {
  addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false, capture: true });
  const zoomKeys = ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'];
  addEventListener('keydown', (e) => { if (e.ctrlKey && zoomKeys.includes(e.code)) e.preventDefault(); }, { capture: true });
  const external = (href) => {
    try { return new URL(href, location.href).origin !== location.origin; } catch { return false; }
  };
  document.addEventListener('click', (e) => {
    // getAttribute, not a.href: an SVG link's href is an SVGAnimatedString, not a URL.
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    const href = a && (a.getAttribute('href') ?? a.getAttribute('xlink:href'));
    if (href == null || e.defaultPrevented || !external(href)) return;
    e.preventDefault();
    window.__kedalionOpenExternal(new URL(href, location.href).href);
  });
  const saveBounds = () => { if (window.__kedalionSaveBounds) window.__kedalionSaveBounds(); };
  setInterval(saveBounds, 1000);
  addEventListener('beforeunload', saveBounds);
  const open = window.open;
  window.open = (url, ...rest) => {
    if (url && external(String(url))) { window.__kedalionOpenExternal(String(url)); return null; }
    return open.call(window, url, ...rest);
  };
})();
`;

self.onmessage = (e: MessageEvent<WindowRequest>) => {
  // The window shows #121212 until the page paints (WEBVIEW2_DEFAULT_BACKGROUND_COLOR has no effect
  // with this webview library); the palette inlined into index.html (themeHead) carries the first paint.
  const { url, title, width, height, debug, stateFile, popout } = e.data;
  const webview = new Webview(debug, { width, height, hint: SizeHint.NONE });
  if (!webview.unsafeHandle) {
    // WebView2 failed to start, e.g. its profile folder is still locked by msedgewebview2.exe
    // processes of a previous run that was killed.
    self.postMessage({ error: 'Could not create the window (WebView2 failed to start).' });
    process.exit(1);
  }
  // Started through `bun run`, the process starts hidden and the library's own show is swallowed.
  const hwnd = webview.unsafeWindowHandle;
  showWindow(hwnd);
  setWindowIconFromExe(hwnd);
  if (popout) self.postMessage({ hwnd: Number(hwnd) });
  if (stateFile) {
    const saved = readPlacement(stateFile);
    if (saved) setWindowPlacement(hwnd, saved);
    // The window is gone once run() returns, so the page reports in while it lives: every second and on unload.
    let last = JSON.stringify(saved ?? null);
    webview.bind('__kedalionSaveBounds', () => {
      const now = getWindowPlacement(hwnd);
      const text = JSON.stringify(now ?? null);
      if (!now || text === last) return;
      last = text;
      try {
        mkdirSync(dirname(stateFile), { recursive: true });
        writeFileSync(stateFile, text);
      } catch {
        // losing the position is harmless
      }
    });
  }
  webview.title = title;
  webview.bind('__kedalionOpenExternal', (href: string) => openExternal(href));
  webview.bind('__kedalionSetZoom', (factor: number) => setWebviewZoom(webview.unsafeHandle as Pointer, factor));
  webview.init(initScript(popout));
  webview.navigate(url);
  webview.run();
  // A pop-out only ends its own worker; the main window ends the process.
  if (!popout) process.exit(0);
  self.postMessage({ closed: true });
};
