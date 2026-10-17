import { readFileSync, rmSync } from 'node:fs';
import { ctlFile, type CtlEndpoint, type CtlSession } from './server/ctl-server.ts';

export const CTL_NAMES = ['running', 'waiting', 'done', 'idle', 'starting', 'error', 'exited', 'stopped'] as const;
const COMMANDS = ['list', 'status', 'screen', 'wait', 'ping'] as const;
type Command = (typeof COMMANDS)[number];

export const CTL_EXIT = { ok: 0, usage: 1, unreachable: 2, timeout: 3 } as const;

export interface CtlArgs {
  command: Command;
  id?: string;
  json: boolean;
  rows?: number;
  /** Seconds; undefined waits forever. */
  timeout?: number;
  status: string[];
}

export const CTL_USAGE = `Usage: <app> ctl <command> [id] [options]

Commands: list | status <id> | screen <id> | wait <id> --status <names> | ping
Options:  --json  --rows <n>  --timeout <seconds>  --status <a,b>
Statuses: ${CTL_NAMES.join(', ')}
Exit codes: 0 ok, 1 bad arguments or server error, 2 not running or unreachable, 3 wait timed out`;

/** Parses the arguments after `ctl`. */
export function parseCtlArgs(args: readonly string[]): CtlArgs | { error: string } {
  const out: CtlArgs = { command: 'list', json: false, status: [] };
  const positional: string[] = [];
  let rows: number | undefined;
  let timeout: number | undefined;
  let status: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') out.json = true;
    else if (a === '--rows' || a === '--timeout' || a === '--status') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      i++;
      if (a === '--rows') {
        if (!/^\d+$/.test(v)) return { error: '--rows wants a whole number of rows' };
        rows = Number(v);
      } else if (a === '--timeout') {
        const n = v.trim() === '' ? NaN : Number(v);
        if (!Number.isFinite(n) || n < 0) return { error: '--timeout wants a number of seconds, 0 or more' };
        timeout = n;
      } else {
        const names = v.split(',').map((s) => s.trim());
        const bad = names.find((n) => !(CTL_NAMES as readonly string[]).includes(n));
        if (bad !== undefined) return { error: `unknown status "${bad}" (${CTL_NAMES.join(', ')})` };
        status = names;
      }
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else positional.push(a);
  }
  const command = positional[0];
  if (command === undefined) return { error: 'missing command' };
  if (!(COMMANDS as readonly string[]).includes(command)) return { error: `unknown command ${command}` };
  out.command = command as Command;
  const needsId = command === 'status' || command === 'screen' || command === 'wait';
  if (needsId && positional.length < 2) return { error: `${command} needs a session id` };
  if (positional.length > (needsId ? 2 : 1)) return { error: `unexpected argument ${positional[needsId ? 2 : 1]}` };
  if (needsId) out.id = positional[1];
  if (command === 'wait' && !status) return { error: 'wait needs --status' };
  if (rows !== undefined && command !== 'screen') return { error: '--rows only applies to screen' };
  if (timeout !== undefined && command !== 'wait') return { error: '--timeout only applies to wait' };
  if (status && command !== 'wait') return { error: '--status only applies to wait' };
  out.rows = rows;
  out.timeout = timeout;
  out.status = status ?? [];
  return out;
}

class Unreachable extends Error {}
class Failed extends Error {}

export interface CtlRpcOptions {
  connectMs?: number;
  callMs?: number;
}

/** One request on a fresh connection. Unreachable: cannot connect or the server went away; Failed: everything else. */
async function rpc(ep: CtlEndpoint, method: string, params: Record<string, unknown>, o: CtlRpcOptions): Promise<unknown> {
  const connectMs = o.connectMs ?? 1000;
  const callMs = o.callMs ?? 5000;
  const reqId = 1;
  return new Promise<unknown>((resolve, reject) => {
    let done = false;
    let connected = false;
    let buf = '';
    let sock: { end(): unknown } | undefined;
    let callTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(callTimer);
      try {
        sock?.end();
      } catch {
        /* already closed */
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(connected ? new Failed('the server did not answer in time') : new Unreachable('connection timed out'))), connectMs);
    Bun.connect({
      hostname: '127.0.0.1',
      port: ep.port,
      socket: {
        open(s) {
          connected = true;
          sock = s;
          clearTimeout(timer);
          callTimer = setTimeout(() => finish(() => reject(new Failed('the server did not answer in time'))), callMs);
          s.write(`${JSON.stringify({ id: reqId, token: ep.token, method, params })}\n`);
        },
        data(_s, chunk) {
          buf += chunk.toString('utf8');
          const nl = buf.indexOf('\n');
          if (nl < 0) return;
          const line = buf.slice(0, nl);
          finish(() => {
            let r: { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
            try {
              r = JSON.parse(line);
            } catch {
              return reject(new Failed('unreadable reply'));
            }
            if (typeof r !== 'object' || r === null || r.id !== reqId) return reject(new Failed('unreadable reply'));
            if (r.ok === true) return resolve(r.result);
            reject(new Failed(typeof r.error === 'string' ? r.error : 'server error'));
          });
        },
        close() {
          finish(() => reject(connected ? new Unreachable('the server closed the connection') : new Unreachable('connection closed')));
        },
        error(_s, e) {
          finish(() => reject(new Unreachable(e.message)));
        },
        connectError(_s, e) {
          finish(() => reject(new Unreachable(e.message)));
        },
      },
    }).catch((e: Error) => finish(() => reject(new Unreachable(e.message))));
  });
}

export interface CtlRunOptions extends CtlRpcOptions {
  /** `<dataDir>/agents`. */
  dir: string;
  /** Whether the config has the ctl server on; only used to word the not-running message. */
  enabled?: () => boolean | Promise<boolean>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Wait poll interval; 500 when omitted. */
  pollMs?: number;
}

const pad = (rows: string[][]): string[] => {
  const w: number[] = [];
  for (const r of rows) r.forEach((c, i) => (w[i] = Math.max(w[i] ?? 0, c.length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]!))).join('  ').trimEnd());
};

export function formatList(sessions: readonly CtlSession[]): string {
  return pad(sessions.map((s) => [s.id, s.status, s.agent, s.project, s.title])).join('\n');
}

export function formatStatus(s: CtlSession): string {
  return [`id: ${s.id}`, `status: ${s.status}`, `live: ${s.live}`, `agent: ${s.agent}`, `project: ${s.project}`, `title: ${s.title}`, `cwd: ${s.cwd}`, `updated: ${s.updatedAt}`].join('\n');
}

function readEndpoint(file: string): { ep: CtlEndpoint; raw: string } | undefined {
  try {
    const raw = readFileSync(file, 'utf8');
    const ep = JSON.parse(raw) as Partial<CtlEndpoint>;
    if (typeof ep.port === 'number' && typeof ep.token === 'string') return { ep: ep as CtlEndpoint, raw };
  } catch {
    /* missing or unreadable */
  }
  return undefined;
}

/** Runs `ctl <args>` and returns the exit code. */
export async function runCtl(args: readonly string[], opts: CtlRunOptions): Promise<number> {
  const out = opts.stdout ?? ((s: string) => void console.log(s));
  const err = opts.stderr ?? ((s: string) => void console.error(s));
  const parsed = parseCtlArgs(args);
  if ('error' in parsed) {
    err(`${parsed.error}\n\n${CTL_USAGE}`);
    return CTL_EXIT.usage;
  }

  const notRunning = async (why: string) => {
    let msg = `Not running or unreachable: ${why}.`;
    if (opts.enabled && (await opts.enabled()) === false) msg += ' The ctl setting (agents.ctl) is off.';
    err(msg);
    return CTL_EXIT.unreachable;
  };

  const file = ctlFile(opts.dir);
  const found = readEndpoint(file);
  if (!found) return notRunning('no ctl.json');
  const { ep } = found;
  try {
    await rpc(ep, 'ping', {}, opts);
  } catch (e) {
    if (e instanceof Unreachable) {
      if (readEndpoint(file)?.raw === found.raw) rmSync(file, { force: true });
      return notRunning(e.message);
    }
    err((e as Error).message);
    return CTL_EXIT.usage;
  }

  const call = (method: string, params: Record<string, unknown> = {}) => rpc(ep, method, params, opts);
  try {
    switch (parsed.command) {
      case 'ping': {
        out(JSON.stringify(await call('ping')));
        return 0;
      }
      case 'list': {
        const r = (await call('list')) as { sessions: CtlSession[] };
        out(parsed.json ? JSON.stringify(r) : formatList(r.sessions));
        return 0;
      }
      case 'status': {
        const r = (await call('status', { id: parsed.id })) as CtlSession;
        out(parsed.json ? JSON.stringify(r) : formatStatus(r));
        return 0;
      }
      case 'screen': {
        const r = (await call('screen', { id: parsed.id, ...(parsed.rows !== undefined ? { lines: parsed.rows } : {}) })) as { lines: string[] };
        out(parsed.json ? JSON.stringify(r) : r.lines.join('\n'));
        return 0;
      }
      case 'wait': {
        const poll = opts.pollMs ?? 500;
        const deadline = parsed.timeout === undefined ? Infinity : Date.now() + parsed.timeout * 1000;
        for (;;) {
          const s = (await call('status', { id: parsed.id })) as CtlSession;
          if (parsed.status.includes(s.status)) {
            out(parsed.json ? JSON.stringify(s) : s.status);
            return 0;
          }
          if (Date.now() + poll > deadline) {
            err(`timed out waiting for ${parsed.status.join(', ')} (now ${s.status})`);
            return CTL_EXIT.timeout;
          }
          await Bun.sleep(poll);
        }
      }
    }
  } catch (e) {
    if (e instanceof Unreachable) return notRunning(e.message);
    err((e as Error).message);
    return CTL_EXIT.usage;
  }
}
