// One native window per Worker: Webview.run() blocks this thread until the window closes.
import { openExternal } from '@deckbase/platform';
import { SizeHint, Webview } from 'webview-bun';
import type { WindowRequest } from './window.ts';

declare const self: Worker;

// Runs before every page load. Tells the UI it is in a window, and sends links to other
// origins to the default browser instead of navigating the app window away.
const INIT = `
window.__DECKBASE_SHELL__ = 'window';
(() => {
  const external = (href) => {
    try { return new URL(href, location.href).origin !== location.origin; } catch { return false; }
  };
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || e.defaultPrevented || !external(a.href)) return;
    e.preventDefault();
    window.__deckbaseOpenExternal(a.href);
  });
  const open = window.open;
  window.open = (url, ...rest) => {
    if (url && external(String(url))) { window.__deckbaseOpenExternal(String(url)); return null; }
    return open.call(window, url, ...rest);
  };
})();
`;

self.onmessage = (e: MessageEvent<WindowRequest>) => {
  const { url, title, width, height, debug } = e.data;
  const webview = new Webview(debug, { width, height, hint: SizeHint.NONE });
  if (!webview.unsafeHandle) {
    // WebView2 failed to start, e.g. its profile folder is still locked by msedgewebview2.exe
    // processes of a previous run that was killed.
    self.postMessage({ error: 'Could not create the window (WebView2 failed to start).' });
    process.exit(1);
  }
  webview.title = title;
  webview.bind('__deckbaseOpenExternal', (href: string) => openExternal(href));
  webview.init(INIT);
  webview.navigate(url);
  webview.run();
  process.exit(0);
};
