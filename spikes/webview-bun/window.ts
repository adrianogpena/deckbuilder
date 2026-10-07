// One native window per Worker: Webview.run() blocks this thread until the window closes.
import { SizeHint, Webview } from 'webview-bun';

declare const self: Worker;

self.onmessage = (e: MessageEvent<{ url: string; title: string }>) => {
  const webview = new Webview(false, { width: 900, height: 600, hint: SizeHint.NONE });
  webview.title = e.data.title;
  webview.navigate(e.data.url);
  webview.run();
  process.exit(0);
};
