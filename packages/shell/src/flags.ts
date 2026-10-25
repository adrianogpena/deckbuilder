import { type AppIdentity, DEV_PORT } from '@kedalion/server-core';

/** The command line of an app, as `runApp` reads it. */
export interface Flags {
  /** The requested way to open the UI; runApp falls back from 'app' to 'browser' without Edge/Chrome. */
  mode: 'window' | 'app' | 'browser' | 'none';
  noOpen: boolean;
  port?: number;
  idleExitMinutes?: number;
  dev: boolean;
  help: boolean;
  openUrl?: string;
  window: boolean;
}

/**
 * Parses the app's arguments (without the executable and script); unknown ones are ignored.
 * With `--open-url` every other flag is ignored: a link holding a raw `"` can inject arguments.
 */
export function parseFlags(argv: string[]): Flags | { error: string } {
  const flag = (name: string) => argv.includes(name);
  const option = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const openUrl = option('--open-url');
  if (openUrl !== undefined) {
    return { mode: 'window', noOpen: false, dev: false, help: false, openUrl, window: false };
  }

  let port: number | undefined;
  if (flag('--port')) {
    const value = option('--port') ?? '';
    port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
    if (!(port <= 65535)) return { error: '--port wants a port number from 0 to 65535.' };
  }
  let idleExitMinutes: number | undefined;
  if (flag('--idle-exit')) {
    idleExitMinutes = Number(option('--idle-exit'));
    if (!(idleExitMinutes > 0)) return { error: '--idle-exit wants a number of minutes greater than 0.' };
  }

  const dev = flag('--dev');
  const noOpen = flag('--no-open');
  const window = flag('--window');
  const mode: Flags['mode'] = flag('--browser') ? (noOpen ? 'none' : 'browser')
    : flag('--app') ? (noOpen ? 'none' : 'app')
    : dev && !window ? 'none' : 'window';
  return {
    mode,
    noOpen,
    port,
    idleExitMinutes,
    dev,
    help: flag('--help') || flag('-h'),
    window,
  };
}

export function helpText(app: AppIdentity): string {
  return `${app.name}

Usage: ${app.id} [--app | --browser [--no-open]] [--port <n>] [--idle-exit <min>] [--dev [--window | --app]]
       ${app.id} --open-url <uri>

  --app              open the UI in an Edge/Chrome app window (falls back to --browser when
                     neither is installed)
  --browser          serve the UI to the default browser instead of opening a window; the
                     Settings screen has a Quit button
  --no-open          with --browser: print the address only
  --port <n>         fixed port (default: any free port)
  --idle-exit <min>  exit after <min> minutes without a request from an open UI (fractions
                     allowed; the exe in --browser mode without a tray icon uses 10 without
                     the flag)
  --open-url <uri>   open a native window on <path> of a ${app.id}://open/<path> link
                     (Windows passes deep links this way)
  --dev              port ${DEV_PORT} for the Vite dev server (opens nothing unless --window, --app
                     or --browser is given; never exits when idle). The printed URL survives
                     reloads; after a watch restart open the newly printed one

When ${app.name} already runs (outside --dev), a new launch opens a window or browser tab of
the running instance instead.
`;
}
