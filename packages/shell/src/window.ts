import { focusWindow, showError, windowExists } from '@deckbuilderkit/platform';

export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  /** Enables the WebView2 dev tools (F12, right-click → Inspect). */
  debug?: boolean;
  /** JSON file where the window's position, size and maximized state are kept between runs. */
  stateFile?: string;
  /** View id of a pop-out window: the page reads it from `__DECKBUILDER_POPOUT__`; closing it leaves the process running. */
  popout?: string;
}

/** Control over an open window. */
export interface WindowHandle {
  /** Brings the window to the front (needs its handle, known once it shows). */
  focus(): void;
  /** Runs once the window has closed (immediately if it already has). */
  onClosed(cb: () => void): void;
}

/** Message the window worker receives. */
export interface WindowRequest {
  url: string;
  title: string;
  width: number;
  height: number;
  debug: boolean;
  stateFile?: string;
  popout?: string;
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
export function openWindow(url: string, opts: WindowOptions, onAllClosed: () => void): WindowHandle {
  open++;
  let hwnd = 0;
  const closedCbs: Array<() => void> = [];
  let closed = false;
  // In the exe this resolves next to the bundled entry, where `deckbuilder build` puts the worker entrypoint.
  const worker = new Worker(new URL('./window-worker.ts', import.meta.url).href);
  const request: WindowRequest = {
    url,
    title: opts.title ?? '',
    width: opts.width ?? DEFAULT_WINDOW.width,
    height: opts.height ?? DEFAULT_WINDOW.height,
    debug: opts.debug ?? false,
    stateFile: opts.stateFile,
    popout: opts.popout,
  };
  worker.postMessage(request);
  let watch: ReturnType<typeof setInterval> | undefined;
  const finish = () => {
    clearInterval(watch);
    if (closed) return;
    closed = true;
    for (const cb of closedCbs) cb();
    if (--open === 0) onAllClosed();
  };
  worker.addEventListener('message', (e: MessageEvent<{ error?: string; hwnd?: number; closed?: boolean }>) => {
    if (e.data.error) showError(opts.title ?? 'Error', e.data.error);
    if (e.data.hwnd) {
      hwnd = e.data.hwnd;
      // A pop-out's worker outlives its window (run() does not return), so the window itself is watched.
      watch = setInterval(() => {
        if (windowExists(hwnd)) return;
        finish();
        worker.terminate();
      }, 500);
    }
    if (e.data.closed) {
      finish();
      worker.terminate();
    }
  });
  worker.addEventListener('error', (e) => showError(opts.title ?? 'Error', `Window failed: ${e.message}`));
  worker.addEventListener('close', finish);
  return {
    focus: () => focusWindow(hwnd),
    onClosed: (cb) => {
      if (closed) cb();
      else closedCbs.push(cb);
    },
  };
}
