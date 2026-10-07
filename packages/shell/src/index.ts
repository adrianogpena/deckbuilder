import { randomBytes } from 'node:crypto';
import {
  type AppIdentity,
  DEV_PORT,
  DEV_TOKEN,
  embeddedWebAssets,
  type Routes,
  startServer,
  TOKEN_PARAM,
  VITE_PORT,
} from '@deckbase/server-core';
import { openExternal } from '@deckbase/platform';
import { openWindow, type WindowOptions } from './window.ts';

export type { WindowOptions } from './window.ts';

export interface RunOptions {
  app: AppIdentity;
  routes: Routes;
  /** Built UI folder, served when running from source; the exe serves its embedded copy instead. */
  webDir: string;
  window?: WindowOptions;
}

type Mode = 'window' | 'browser' | 'none';

/**
 * Starts the local server, then opens the UI in a native window (default) or the browser.
 * Run `<app> --help` for the flags.
 */
export function runApp(opts: RunOptions): void {
  const { app } = opts;
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(name);
  const option = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (flag('--help') || flag('-h')) {
    console.log(`${app.name}

Usage: ${app.id} [--browser [--no-open]] [--port <n>] [--dev [--window]]

  --browser    serve the UI to the default browser instead of opening a window
  --no-open    with --browser: print the address only
  --port <n>   fixed port (default: any free port)
  --dev        port ${DEV_PORT} and token "${DEV_TOKEN}" for the Vite dev server (opens nothing
               unless --window or --browser is given)
`);
    process.exit(0);
  }

  const dev = flag('--dev');
  const mode: Mode = flag('--browser') ? 'browser' : dev && !flag('--window') ? 'none' : 'window';
  const port = Number(option('--port') ?? (dev ? DEV_PORT : 0));
  const token = dev ? DEV_TOKEN : randomBytes(24).toString('hex');
  const embedded = embeddedWebAssets();

  let server: ReturnType<typeof startServer>;
  try {
    server = startServer({ routes: opts.routes, token, port, web: embedded ? { files: embedded } : { dir: opts.webDir } });
  } catch (err) {
    if ((err as { code?: string }).code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Pass --port with another port.`);
    else console.error(err);
    process.exit(1);
  }

  const origin = dev ? `http://localhost:${VITE_PORT}` : `http://127.0.0.1:${server.port}`;
  const url = `${origin}/?${TOKEN_PARAM}=${token}`;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.stop(true);
      process.exit(0);
    });
  }

  if (mode === 'window') {
    // WebView2 keeps its profile in %APPDATA%\<exe name>\: the webview library passes that
    // folder explicitly, so WEBVIEW2_USER_DATA_FOLDER has no effect.
    const open = () =>
      openWindow(url, { title: app.name, debug: dev, ...opts.window }, () => {
        void server.stop(true);
        process.exit(0);
      });
    // `deckbase dev` starts Vite only once this server answers; don't load the page before Vite does.
    if (dev) void waitFor(origin).then(open);
    else open();
    return;
  }

  console.log(`\n  ${app.name} running at ${url}\n  Press Ctrl+C to stop.\n`);
  if (mode === 'browser' && !flag('--no-open')) openExternal(url);
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
