import { isCompiledExe } from '../exe.ts';
import { type Runner, runWithTimeout } from '../run.ts';

const TIMEOUT_MS = 10_000;

export interface UrlProtocolOptions {
  /** URL scheme, e.g. `kedalion` for `kedalion://…`. */
  scheme: string;
  /** Display name; Windows shows `URL:<name>`. */
  name: string;
  execPath?: string;
  run?: Runner;
  /** False when running from source or off Windows: then nothing touches the registry. */
  enabled?: boolean;
  onWarn?: (msg: string) => void;
}

export interface UrlProtocol {
  /** Writes the protocol keys; a no-op when not enabled. */
  register(): Promise<void>;
  /** The registered open command, or null when absent. */
  registered(): Promise<string | null>;
  /** Registers the protocol when absent or when the exe moved since it was registered. */
  fixUp(): Promise<void>;
}

const protocolKey = (scheme: string): string => `HKCU\\Software\\Classes\\${scheme}`;

const openCommand = (execPath: string): string => `"${execPath}" --open-url "%1"`;

/** One `reg.exe add` per value the protocol needs. */
export function protocolArgv(scheme: string, name: string, execPath: string): string[][] {
  const key = protocolKey(scheme);
  return [
    ['reg.exe', 'add', key, '/ve', '/d', `URL:${name}`, '/f'],
    ['reg.exe', 'add', key, '/v', 'URL Protocol', '/d', '', '/f'],
    ['reg.exe', 'add', `${key}\\DefaultIcon`, '/ve', '/d', `"${execPath}",0`, '/f'],
    ['reg.exe', 'add', `${key}\\shell\\open\\command`, '/ve', '/d', openCommand(execPath), '/f'],
  ];
}

/** The data of the first REG_SZ value in `reg.exe query` output; the default value's name is localized. */
export function parseFirstRegSz(stdout: string): string | null {
  const m = stdout.match(/^\s*\S.*?\s+REG_SZ\s+(.+?)\s*$/m);
  return m?.[1] ?? null;
}

/** Registers `<scheme>://` under HKCU so Windows opens such links with the exe (`--open-url <uri>`). */
export function createUrlProtocol(opts: UrlProtocolOptions): UrlProtocol {
  const run = opts.run ?? runWithTimeout;
  const execPath = opts.execPath ?? process.execPath;
  const enabled = opts.enabled ?? (process.platform === 'win32' && isCompiledExe(execPath));
  const warn = opts.onWarn ?? ((msg) => console.warn(`url protocol: ${msg}`));

  const registered = async (): Promise<string | null> => {
    const r = await run(['reg.exe', 'query', `${protocolKey(opts.scheme)}\\shell\\open\\command`, '/ve'], TIMEOUT_MS);
    return r.kind === 'done' && r.code === 0 ? parseFirstRegSz(r.stdout) : null;
  };

  const register = async (): Promise<void> => {
    if (!enabled) return;
    for (const cmd of protocolArgv(opts.scheme, opts.name, execPath)) {
      const r = await run(cmd, TIMEOUT_MS);
      if (r.kind === 'timeout' || r.code !== 0) {
        warn(`reg.exe failed: ${r.kind === 'done' ? r.stderr.trim() : 'timeout'}`);
        return;
      }
    }
  };

  return {
    register,
    registered,
    async fixUp() {
      if (!enabled) return;
      if ((await registered()) !== openCommand(execPath)) await register();
    },
  };
}
