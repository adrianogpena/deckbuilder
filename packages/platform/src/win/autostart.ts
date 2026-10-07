import { isCompiledExe } from '../exe.ts';
import { type Runner, runWithTimeout } from '../run.ts';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const TIMEOUT_MS = 10_000;

export interface AutostartOptions {
  /** Registry value name, usually the app's display name. */
  name: string;
  /** Flags the exe gets at login. */
  args?: string[];
  run?: Runner;
  execPath?: string;
  /** False when running from source or off Windows: then nothing touches the registry. */
  enabled?: boolean;
  onWarn?: (msg: string) => void;
}

export interface Autostart {
  /** Registers or removes the Run value; a no-op when not enabled. */
  set(on: boolean): Promise<void>;
  /** The registered command, or null when absent. */
  registered(): Promise<string | null>;
  /** Registers the Run value when absent or when the exe moved since it was registered. */
  fixUp(): Promise<void>;
}

export const runCommand = (execPath: string, args: string[] = []): string => [`"${execPath}"`, ...args].join(' ');

export function autostartArgv(name: string, on: boolean, command: string): string[] {
  return on
    ? ['reg.exe', 'add', RUN_KEY, '/v', name, '/t', 'REG_SZ', '/d', command, '/f']
    : ['reg.exe', 'delete', RUN_KEY, '/v', name, '/f'];
}

/** The data of value `name` in `reg.exe query` output. */
export function parseRegQuery(stdout: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stdout.match(new RegExp(`^\\s*${escaped}\\s+REG_SZ\\s+(.+?)\\s*$`, 'm'));
  return m?.[1] ?? null;
}

/** Starts the exe at Windows login through the HKCU Run key. */
export function createAutostart(opts: AutostartOptions): Autostart {
  const run = opts.run ?? runWithTimeout;
  const execPath = opts.execPath ?? process.execPath;
  const enabled = opts.enabled ?? (process.platform === 'win32' && isCompiledExe(execPath));
  const command = runCommand(execPath, opts.args);
  const warn = opts.onWarn ?? ((msg) => console.warn(`autostart: ${msg}`));

  const registered = async (): Promise<string | null> => {
    const r = await run(['reg.exe', 'query', RUN_KEY, '/v', opts.name], TIMEOUT_MS);
    return r.kind === 'done' && r.code === 0 ? parseRegQuery(r.stdout, opts.name) : null;
  };

  const set = async (on: boolean): Promise<void> => {
    if (!enabled) return;
    if (!on && (await registered()) === null) return;
    const r = await run(autostartArgv(opts.name, on, command), TIMEOUT_MS);
    if (r.kind === 'timeout' || r.code !== 0) warn(`reg.exe failed: ${r.kind === 'done' ? r.stderr.trim() : 'timeout'}`);
  };

  return {
    set,
    registered,
    async fixUp() {
      if (!enabled) return;
      if ((await registered()) !== command) await set(true);
    },
  };
}
