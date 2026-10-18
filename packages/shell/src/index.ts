import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  type AppIdentity,
  DEV_PORT,
  embeddedWebAssets,
  type IndexTransform,
  isUrlScheme,
  launchCodes,
  type Routes,
  type SocketRoutes,
  startServer,
  VITE_PORT,
} from '@deckbuilderkit/server-core';
import { appHome, createTray, createUrlProtocol, findAppBrowser, isCompiledExe, openExternal, removeOldExe, type Tray, waitForUrl } from '@deckbuilderkit/platform';
import { appWindowsOpen, closeAppWindows, openAppWindow } from './app-window.ts';
import { helpText, parseFlags } from './flags.ts';
import { createIdleWatch, type IdleWatch } from './idle.ts';
import { acquireLock, createInstance, handOff, type OpenMode } from './instance.ts';
import { parseAppLink } from './link.ts';
import { launchUrl } from './urls.ts';
import { openWindow, openWindows, type WindowOptions } from './window.ts';

export type { OpenMode } from './instance.ts';
export { DEFAULT_WINDOW, type WindowOptions } from './window.ts';

/** What `onStart` gets to act on the running app. */
export interface StartContext {
  /**
   * A link that opens the app on `#<path>`, e.g. for a toast's `launch`: `<id>://open/<path>` when
   * `urlProtocol` is on in the Windows exe, else the local address with no secret in it (toast XML
   * is stored on disk), which opens on the invalid-session message. Links that must work need
   * `urlProtocol: true`.
   */
  link(path: string): string;
  /** Opens a window (or browser tab) like a new launch would, on `#<path>` when given. */
  show(mode: OpenMode, path?: string): void;
  quit(): Promise<void>;
}

export interface TrayMenu {
  /** Default "Open <app name>". */
  openLabel?: string;
  /** Default "Quit". */
  quitLabel?: string;
  /** Entries between Open and Quit; ids must not start with `__`. */
  items?: { id: string; label: string; run(): void }[];
}

export interface RunOptions {
  app: AppIdentity;
  /** The app's API; as a function it gets the start context, called before the server serves. */
  routes: Routes | ((ctx: StartContext) => Routes);
  /** WebSocket routes (see `startServer`); as a function it gets the start context, like `routes`. */
  sockets?: SocketRoutes | ((ctx: StartContext) => SocketRoutes);
  /** Routes outside the session token check (see `startServer`); as a function it gets the start context, like `routes`. */
  unauthenticated?: Routes | ((ctx: StartContext) => Routes);
  /** Awaited first on every exit path (window close, tray Quit, `/api/quit`, idle, signals); errors are logged and ignored. */
  onQuit?: () => void | Promise<void>;
  /** Asked before a window close or tray Quit ends the app; false keeps it running (a closed window is reopened). */
  confirmQuit?: () => boolean | Promise<boolean>;
  /** Built UI folder, served when running from source; the exe serves its embedded copy instead. */
  webDir: string;
  /** Rewrites `index.html` before it is served, e.g. `themeHead(settings)` for the saved colours. */
  transformIndex?: IndexTransform;
  window?: WindowOptions;
  /**
   * Registers `<app.id>://` on Windows (exe only), so `<id>://open/<path>` links open the app;
   * `app.id` must then be a valid URL scheme.
   */
  urlProtocol?: boolean;
  /**
   * A notification-area icon (Windows, not in --dev) with Open, the app's entries and Quit. The
   * app then keeps running when its last window closes, and only exits when idle with --idle-exit.
   */
  tray?: boolean | TrayMenu;
  /**
   * Command-line subcommands (`<app> <name> ...`): when the first argument names one, it runs with the
   * rest of the arguments before any flag is read or window opens, and the app exits with its code.
   */
  subcommands?: Record<string, (args: string[]) => number | Promise<number>>;
  /** Runs once the server listens; not in a launch that hands off to a running instance. */
  onStart?: (ctx: StartContext) => void | Promise<void>;
}

/**
 * Starts the local server, then opens the UI in a native window (default), an Edge/Chrome app
 * window or the browser. Outside --dev only one instance runs: a second launch makes the running
 * one open a new window (or browser tab) and exits. Run `<app> --help` for the flags.
 */
export async function runApp(opts: RunOptions): Promise<void> {
  const { app } = opts;
  const argv = process.argv.slice(2);
  const sub = argv[0] !== undefined ? opts.subcommands?.[argv[0]] : undefined;
  if (sub) process.exit(await sub(argv.slice(1)));
  const flags = parseFlags(argv);
  if ('error' in flags) {
    console.error(`${flags.error}\n\n${helpText(app)}`);
    process.exit(1);
  }
  if (flags.help) {
    console.log(helpText(app));
    process.exit(0);
  }
  if (flags.dev && isCompiledExe()) {
    console.error('--dev only works from source.');
    process.exit(1);
  }

  if (opts.urlProtocol && !isUrlScheme(app.id)) {
    throw new Error(`urlProtocol needs an app id that is a valid URL scheme, not "${app.id}".`);
  }
  const trayMenu = opts.tray === true ? {} : opts.tray || null;
  const reserved = trayMenu?.items?.find((item) => item.id.startsWith('__'));
  if (reserved) throw new Error(`Tray entry ids must not start with "__", got "${reserved.id}".`);
  const { dev, openUrl, idleExitMinutes: idleMinutes } = flags;
  // A link that doesn't parse still opens the app, just without a path.
  const startPath = openUrl === undefined ? undefined : (parseAppLink(openUrl, app.id) ?? undefined);
  let mode: OpenMode = flags.mode;
  const browser = mode === 'app' ? findAppBrowser() : null;
  if (mode === 'app' && !browser) {
    console.warn('No Edge or Chrome found for --app; using the default browser.');
    mode = 'browser';
  }
  const port = flags.port ?? (dev ? DEV_PORT : 0);
  const token = randomBytes(24).toString('hex');
  // Launch URLs carry one-time codes, never the token; the dev code stays valid so reloads work.
  const codes = launchCodes({ reusable: dev });
  const embedded = embeddedWebAssets();
  const instanceFile = join(appHome(app.id), 'instance.json');

  const alreadyRunning = (running: true | string) => {
    if (running === true) console.log(`${app.name} is already running; opened a new ${mode === 'browser' ? 'browser tab' : 'window'}.`);
    else console.log(`${app.name} is already running at ${running}`);
    process.exit(0);
  };
  // Another launch holds the start-up lock: wait until it answers as the instance.
  const waitForOther = async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await Bun.sleep(250);
      const running = await handOff(instanceFile, mode, startPath);
      if (running) alreadyRunning(running);
    }
    console.error(`Another ${app.name} launch is starting but doesn't answer. Try again.`);
    process.exit(1);
  };
  if (!dev) {
    const lockFile = join(appHome(app.id), 'instance.lock');
    // Started by the previous exe after it swapped itself out: wait until that one has exited.
    if (flags.afterUpdate && isCompiledExe()) await removeOldExe(process.execPath);
    else {
      const running = await handOff(instanceFile, mode, startPath);
      if (running) alreadyRunning(running);
    }
    if (acquireLock(lockFile) === 'held') await waitForOther();
  }

  // Where the UI is served: Vite in --dev, else this server. Set once the server listens.
  let origin = '';
  let idle: IdleWatch | null = null;
  // Set while the tray icon starts or shows; `trayShown` once it does.
  let tray: Tray | null = null;
  let trayShown = false;
  let closedWhileTrayStarts = false;
  // Only the explicit --idle-exit watch, created at startup, survives the tray showing.
  const enableIdleExit = (ms: number) => {
    if (dev || idle || trayShown) return;
    idle = createIdleWatch({ timeoutMs: ms, onIdle: () => void quit() });
  };
  const disableIdleExit = () => {
    idle?.stop();
    idle = null;
  };
  /** The single exit path. */
  const quit = async (): Promise<void> => {
    disableIdleExit();
    try {
      await opts.onQuit?.();
    } catch (err) {
      console.error(err);
    }
    closeAppWindows();
    await Promise.all([server?.stop(true), tray?.close()]);
    process.exit(0);
  };
  const quitAsking = async (reopen: boolean): Promise<void> => {
    let ok = true;
    try {
      ok = (await opts.confirmQuit?.()) !== false;
    } catch (err) {
      console.error(err);
    }
    if (ok) return quit();
    if (reopen && mode !== 'none' && mode !== 'browser') show(mode);
  };
  // Native windows and app windows both report here; the app ends once neither kind is open,
  // unless it has a tray icon. While the icon starts, it waits to see whether it shows.
  const onAllClosed = () => {
    if (openWindows() > 0 || appWindowsOpen()) return;
    if (!tray) void quitAsking(true);
    else if (!trayShown) closedWhileTrayStarts = true;
  };
  // WebView2 keeps its profile in %APPDATA%\<exe name>\: the webview library passes that
  // folder explicitly, so WEBVIEW2_USER_DATA_FOLDER has no effect.
  const openNative = (url: string) => {
    openWindow(url, { title: app.name, debug: dev, stateFile: join(appHome(app.id), 'window.json'), ...opts.window }, onAllClosed);
  };
  const show = (m: OpenMode, path?: string): string => {
    const url = launchUrl(origin, codes, path);
    if (m === 'window') openNative(url);
    else if (m === 'app') {
      const exe = browser ?? findAppBrowser();
      if (!exe) openExternal(url);
      else {
        openAppWindow(
          url,
          {
            browser: exe,
            profileDir: join(appHome(app.id), 'app-profile'),
            window: opts.window,
            // Windows of a browser process we don't watch never report closing: end when idle instead.
            onUntracked: () => enableIdleExit(10 * 60_000),
            onMainStarted: () => {
              if (idleMinutes === undefined) disableIdleExit();
            },
          },
          onAllClosed,
        );
      }
    } else if (m === 'browser') openExternal(url);
    return url;
  };
  const instance = dev ? null : createInstance(instanceFile, show);

  const linkViaProtocol = !!opts.urlProtocol && process.platform === 'win32' && isCompiledExe();
  // Filled in once the server listens; routes only run after that.
  let serverPort = 0;
  const ctx: StartContext = {
    link: (path) => (linkViaProtocol ? `${app.id}://open/${path}` : `http://127.0.0.1:${serverPort}/#${path}`),
    show: (m, path) => void show(m, path),
    quit,
  };

  const routes: Routes = {
    ...(typeof opts.routes === 'function' ? opts.routes(ctx) : opts.routes),
    'POST /api/quit': () => {
      setTimeout(() => void quit(), 200);
      return { ok: true };
    },
    'POST /api/alive': () => ({ ok: true }),
  };

  const sockets = typeof opts.sockets === 'function' ? opts.sockets(ctx) : opts.sockets;
  const unauthenticated: Routes = { ...instance?.routes, ...(typeof opts.unauthenticated === 'function' ? opts.unauthenticated(ctx) : opts.unauthenticated) };

  let server: ReturnType<typeof startServer> | undefined;
  try {
    server = startServer({
      routes,
      sockets,
      unauthenticated,
      token,
      codes,
      devOrigins: dev ? [`http://localhost:${VITE_PORT}`, `http://127.0.0.1:${VITE_PORT}`] : undefined,
      port,
      web: { ...(embedded ? { files: embedded } : { dir: opts.webDir }), transformIndex: opts.transformIndex },
      onActivity: () => idle?.touch(),
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Pass --port with another port.`);
    else console.error(err);
    process.exit(1);
  }

  serverPort = server.port!;
  origin = dev ? `http://localhost:${VITE_PORT}` : `http://127.0.0.1:${serverPort}`;
  instance?.publish(serverPort);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void quit());
  // The exe in browser mode has no window to close, so it ends once no tab has called for a while.
  if (idleMinutes !== undefined) enableIdleExit(idleMinutes * 60_000);
  else if (mode === 'browser' && isCompiledExe()) enableIdleExit(10 * 60_000);

  if (opts.urlProtocol) {
    void createUrlProtocol({ scheme: app.id, name: app.name }).fixUp().catch((err) => console.error(err));
  }
  if (trayMenu && !dev) {
    tray = startTray({
      name: app.name,
      menu: trayMenu,
      open: () => void show(mode === 'none' ? 'window' : mode),
      quit: () => void quitAsking(false),
      onShown: () => {
        trayShown = true;
        if (idleMinutes === undefined) disableIdleExit();
      },
      onFailed: (err) => {
        console.warn(`No tray icon: ${err.message}`);
        tray = null;
        if (closedWhileTrayStarts) onAllClosed();
      },
    });
  }
  void Promise.resolve(opts.onStart?.(ctx)).catch((err) => console.error(err));

  // Prints the URL the first open used: one-time outside --dev, so with --no-open it is still unused.
  const announce = (url: string) => {
    if (mode !== 'window') console.log(`\n  ${app.name} running at ${url}\n  Press Ctrl+C to stop.\n`);
  };
  // `deckbuilder dev` starts Vite only once this server answers; don't load the page before Vite does.
  if (dev && (mode === 'window' || mode === 'app')) void waitForUrl(origin, { timeoutMs: 30_000 }).then(() => announce(show(mode, startPath)));
  else announce(show(mode, startPath));
}

/** Shows the tray icon with Open, the app's entries and Quit; null where there is no tray. */
function startTray(o: {
  name: string;
  menu: TrayMenu;
  open: () => void;
  quit: () => void;
  onShown: () => void;
  onFailed: (err: Error) => void;
}): Tray | null {
  const entries = [
    { id: '__open', label: o.menu.openLabel ?? `Open ${o.name}`, run: o.open },
    ...(o.menu.items ?? []),
    { id: '__quit', label: o.menu.quitLabel ?? 'Quit', run: o.quit },
  ];
  const tray = createTray({
    tooltip: o.name,
    items: entries.map(({ id, label }) => ({ id, label })),
    onSelect: (id) => entries.find((entry) => entry.id === id)?.run(),
  });
  if (!tray.supported) return null;
  tray.ready.then(o.onShown, o.onFailed);
  return tray;
}
