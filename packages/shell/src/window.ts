import { showError } from '@deckbuilderkit/platform';

export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  /** Enables the WebView2 dev tools (F12, right-click → Inspect). */
  debug?: boolean;
  /** JSON file where the window's position, size and maximized state are kept between runs. */
  stateFile?: string;
}

/** Message the window worker receives. */
export interface WindowRequest {
  url: string;
  title: string;
  width: number;
  height: number;
  debug: boolean;
  stateFile?: string;
}

/** Size of a new native or app window unless the app passes one. */
export const DEFAULT_WINDOW = { width: 1280, height: 820 };

let open = 0;

/** Native windows that are still open. */
export function openWindows(): number {
  return open;
}

/**
 * Opens a native window on `url`. Each window runs in its own Worker because Webview.run()
 * blocks its thread; the server stays on the main thread. `onAllClosed` runs when the last one closes.
 */
export function openWindow(url: string, opts: WindowOptions, onAllClosed: () => void): void {
  open++;
  // In the exe this resolves next to the bundled entry, where `deckbuilder build` puts the worker entrypoint.
  const worker = new Worker(new URL('./window-worker.ts', import.meta.url).href);
  const request: WindowRequest = {
    url,
    title: opts.title ?? '',
    width: opts.width ?? DEFAULT_WINDOW.width,
    height: opts.height ?? DEFAULT_WINDOW.height,
    debug: opts.debug ?? false,
    stateFile: opts.stateFile,
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
