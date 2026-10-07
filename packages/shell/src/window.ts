import { showError } from '@deckbase/platform';

export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  /** Enables the WebView2 dev tools (F12, right-click → Inspect). */
  debug?: boolean;
}

/** Message the window worker receives. */
export interface WindowRequest {
  url: string;
  title: string;
  width: number;
  height: number;
  debug: boolean;
}

let open = 0;

/**
 * Opens a native window on `url`. Each window runs in its own Worker because Webview.run()
 * blocks its thread; the server stays on the main thread. `onAllClosed` runs when the last one closes.
 */
export function openWindow(url: string, opts: WindowOptions, onAllClosed: () => void): void {
  open++;
  // In the exe this resolves next to the bundled entry, where `deckbase build` puts the worker entrypoint.
  const worker = new Worker(new URL('./window-worker.ts', import.meta.url).href);
  const request: WindowRequest = {
    url,
    title: opts.title ?? '',
    width: opts.width ?? 1280,
    height: opts.height ?? 820,
    debug: opts.debug ?? false,
  };
  worker.postMessage(request);
  worker.addEventListener('message', (e: MessageEvent<{ error?: string }>) => {
    if (e.data.error) showError(opts.title ?? 'Error', e.data.error);
  });
  worker.addEventListener('error', (e) => showError(opts.title ?? 'Error', `Window failed: ${e.message}`));
  worker.addEventListener('close', () => {
    if (--open === 0) onAllClosed();
  });
}
