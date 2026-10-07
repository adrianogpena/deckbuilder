import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  type AppIdentity,
  DEV_PORT,
  DEV_TOKEN,
  embeddedWebAssets,
  type Routes,
  startServer,
  TOKEN_PARAM,
  VITE_PORT,
} from '@deckbuilder/server-core';
import { appHome, isCompiledExe, openExternal, removeOldExe } from '@deckbuilder/platform';
import { createIdleWatch, type IdleWatch } from './idle.ts';
import { acquireLock, createInstance, handOff, type OpenMode } from './instance.ts';
import { openWindow, type WindowOptions } from './window.ts';

export type { OpenMode } from './instance.ts';
export type { WindowOptions } from './window.ts';

export interface RunOptions {
  app: AppIdentity;
  routes: Routes;
  /** Built UI folder, served when running from source; the exe serves its embedded copy instead. */
  webDir: string;
  window?: WindowOptions;
  /** Runs once the server listens; not in a launch that hands off to a running instance. */
  onStart?: () => void | Promise<void>;
}

/**
 * Starts the local server, then opens the UI in a native window (default) or the browser.
 * Outside --dev only one instance runs: a second launch makes the running one open a new
 * window (or browser tab) and exits. Run `<app> --help` for the flags.
 */
export async function runApp(opts: RunOptions): Promise<void> {
  const { app } = opts;
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(name);
  const option = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (flag('--help') || flag('-h')) {
    console.log(`${app.name}

Usage: ${app.id} [--browser [--no-open]] [--port <n>] [--idle-exit <min>] [--dev [--window]]

  --browser          serve the UI to the default browser instead of opening a window; the
                     Settings screen has a Quit button
  --no-open          with --browser: print the address only
  --port <n>         fixed port (default: any free port)
  --idle-exit <min>  exit after <min> minutes without a request from an open UI (fractions
                     allowed; the exe in --browser mode uses 10 without the flag)
  --dev              port ${DEV_PORT} and token "${DEV_TOKEN}" for the Vite dev server (opens nothing
                     unless --window or --browser is given; never exits when idle)

When ${app.name} already runs (outside --dev), a new launch opens a window or browser tab of
the running instance instead.
`);
    process.exit(0);
  }

  const dev = flag('--dev');
  const mode: OpenMode = flag('--browser') ? (flag('--no-open') ? 'none' : 'browser') : dev && !flag('--window') ? 'none' : 'window';
  const port = Number(option('--port') ?? (dev ? DEV_PORT : 0));
  const token = dev ? DEV_TOKEN : randomBytes(24).toString('hex');
  const embedded = embeddedWebAssets();
  const instanceFile = join(appHome(app.id), 'instance.json');
  const idleOption = option('--idle-exit');
  const idleMinutes = idleOption === undefined ? undefined : Number(idleOption);
  if (idleMinutes !== undefined && !(idleMinutes > 0)) {
    console.error('--idle-exit wants a number of minutes greater than 0.');
    process.exit(1);
  }

  const alreadyRunning = (running: string) => {
    console.log(`${app.name} is already running at ${running}`);
    process.exit(0);
  };
  // Another launch holds the start-up lock: wait until it answers as the instance.
  const waitForOther = async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await Bun.sleep(250);
      const running = await handOff(instanceFile, mode);
      if (running) alreadyRunning(running);
    }
    console.error(`Another ${app.name} launch is starting but doesn't answer. Try again.`);
    process.exit(1);
  };
  if (!dev) {
    const lockFile = join(appHome(app.id), 'instance.lock');
    // Started by the previous exe after it swapped itself out: wait until that one has exited.
    if (flag('--after-update') && isCompiledExe()) await removeOldExe(process.execPath);
    else {
      const running = await handOff(instanceFile, mode);
      if (running) alreadyRunning(running);
    }
    if (acquireLock(lockFile) === 'held') await waitForOther();
  }

  let url = '';
  let idle: IdleWatch | null = null;
  const enableIdleExit = (ms: number) => {
    if (dev || idle) return;
    idle = createIdleWatch({ timeoutMs: ms, onIdle: () => void quit() });
  };
  const disableIdleExit = () => {
    idle?.stop();
    idle = null;
  };
  /** The single exit path. */
  const quit = async (): Promise<void> => {
    disableIdleExit();
    await server?.stop(true);
    process.exit(0);
  };
  // WebView2 keeps its profile in %APPDATA%\<exe name>\: the webview library passes that
  // folder explicitly, so WEBVIEW2_USER_DATA_FOLDER has no effect.
  const show = (m: OpenMode): string => {
    if (m === 'window') openWindow(url, { title: app.name, debug: dev, ...opts.window }, () => void quit());
    else if (m === 'browser') openExternal(url);
    return url;
  };
  const instance = dev ? null : createInstance(instanceFile, show);

  const routes: Routes = {
    ...opts.routes,
    'POST /api/quit': () => {
      setTimeout(() => void quit(), 200);
      return { ok: true };
    },
    'POST /api/alive': () => ({ ok: true }),
  };

  let server: ReturnType<typeof startServer> | undefined;
  try {
    server = startServer({
      routes,
      unauthenticated: instance?.routes,
      token,
      port,
      web: embedded ? { files: embedded } : { dir: opts.webDir },
      onActivity: () => idle?.touch(),
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Pass --port with another port.`);
    else console.error(err);
    process.exit(1);
  }

  const origin = dev ? `http://localhost:${VITE_PORT}` : `http://127.0.0.1:${server.port}`;
  url = `${origin}/?${TOKEN_PARAM}=${token}`;
  instance?.publish(server.port!);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void quit());
  // The exe in browser mode has no window to close, so it ends once no tab has called for a while.
  if (idleMinutes !== undefined) enableIdleExit(idleMinutes * 60_000);
  else if (mode === 'browser' && isCompiledExe()) enableIdleExit(10 * 60_000);

  void Promise.resolve(opts.onStart?.()).catch((err) => console.error(err));

  if (mode !== 'window') console.log(`\n  ${app.name} running at ${url}\n  Press Ctrl+C to stop.\n`);
  // `deckbuilder dev` starts Vite only once this server answers; don't load the page before Vite does.
  if (dev && mode === 'window') void waitFor(origin).then(() => show(mode));
  else show(mode);
}

/** Resolves once `url` answers, or after 30 s. */
async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await Bun.sleep(200);
    }
  }
}
