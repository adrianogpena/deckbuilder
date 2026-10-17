import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentStatus } from '../protocol.ts';

/** ctl status names by agents status (Waiting is `needs-you` on the wire). */
export const CTL_STATUS: Record<AgentStatus, string> = { running: 'running', 'needs-you': 'waiting', done: 'done', idle: 'idle', starting: 'starting', error: 'error', exited: 'exited', stopped: 'stopped' };

export interface CtlSession {
  id: string;
  agent: string;
  title: string;
  project: string;
  status: string;
  live: boolean;
  cwd: string;
  updatedAt: string;
}

export interface CtlDeps {
  version: string;
  pid: number;
  /** Every session with an id. */
  list(): Promise<CtlSession[]> | CtlSession[];
  /** Visible rows of a session live here; undefined when it is not running here. */
  screenLines(id: string, n: number): string[] | undefined;
}

export interface CtlEndpoint {
  port: number;
  token: string;
  pid: number;
}

export interface CtlServer extends CtlEndpoint {
  stop(): void;
}

export interface CtlOptions {
  /** `<dataDir>/agents`: ctl.json is written here. */
  dir: string;
  deps: CtlDeps;
  /** Reply deadline of a method; 2000 when omitted. */
  answerMs?: number;
  /** Idle connection limit; 5000 when omitted. */
  idleMs?: number;
}

export const CTL_MAX_LINE = 1024 * 1024;

export class CtlError extends Error {}

/** Resolves an exact id or a unique prefix. */
export function matchSessionId(want: unknown, ids: readonly string[]): { ok: true; id: string } | { ok: false; error: string } {
  if (typeof want !== 'string' || want === '') return { ok: false, error: 'missing session id' };
  if (ids.includes(want)) return { ok: true, id: want };
  const hits = ids.filter((i) => i.startsWith(want));
  if (hits.length === 1) return { ok: true, id: hits[0]! };
  if (hits.length > 1) return { ok: false, error: `ambiguous session id: ${want}` };
  return { ok: false, error: `no session with id ${want}` };
}

/** Rows right-trimmed, trailing blank rows dropped, optionally only the last `n`. */
export function trimScreen(lines: readonly string[], n?: number): string[] {
  const rows = lines.map((l) => l.trimEnd());
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return n !== undefined && n >= 0 ? (n === 0 ? [] : rows.slice(-n)) : rows;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameToken = (a: unknown, b: string) => typeof a === 'string' && timingSafeEqual(digest(a), digest(b));

export const ctlFile = (dir: string) => join(dir, 'ctl.json');

async function resolveSession(deps: CtlDeps, id: unknown): Promise<CtlSession> {
  const all = await deps.list();
  const m = matchSessionId(id, all.map((s) => s.id));
  if (!m.ok) throw new CtlError(m.error);
  return all.find((s) => s.id === m.id)!;
}

async function call(deps: CtlDeps, method: unknown, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'ping':
      return { version: deps.version, pid: deps.pid };
    case 'list':
      return { sessions: await deps.list() };
    case 'status':
      return await resolveSession(deps, params.id);
    case 'screen': {
      const s = await resolveSession(deps, params.id);
      const n = params.lines ?? params.n;
      const rows = deps.screenLines(s.id, 1000);
      if (!rows) throw new CtlError('session is not running here');
      return { id: s.id, lines: trimScreen(rows, typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : undefined) };
    }
    default:
      throw new CtlError(`unknown method: ${String(method)}`);
  }
}

interface Conn {
  buf: string;
  idle?: ReturnType<typeof setTimeout>;
}

/** Starts the read-only ctl listener on 127.0.0.1 (any free port) and publishes ctl.json. Throws when it cannot start. */
export function startCtlServer(opts: CtlOptions): CtlServer {
  const { deps } = opts;
  const answerMs = opts.answerMs ?? 2000;
  const idleMs = opts.idleMs ?? 5000;
  const token = randomBytes(32).toString('hex');
  const send = (s: { write(d: string): unknown }, v: unknown) => void s.write(`${JSON.stringify(v)}\n`);

  const handle = async (line: string, s: { write(d: string): unknown; end(): unknown }) => {
    let req: unknown;
    try {
      req = JSON.parse(line);
    } catch {
      return send(s, { id: null, ok: false, error: 'malformed request' });
    }
    if (typeof req !== 'object' || req === null || Array.isArray(req)) return send(s, { id: null, ok: false, error: 'malformed request' });
    const r = req as Record<string, unknown>;
    const id = typeof r.id === 'number' ? r.id : null;
    if (!sameToken(r.token, token)) {
      send(s, { id, ok: false, error: 'bad token' });
      s.end();
      return;
    }
    if (id === null || typeof r.method !== 'string') return send(s, { id, ok: false, error: 'malformed request' });
    const params = typeof r.params === 'object' && r.params !== null && !Array.isArray(r.params) ? (r.params as Record<string, unknown>) : {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new CtlError('did not answer in time')), answerMs);
      });
      const result = await Promise.race([call(deps, r.method, params), timeout]);
      send(s, { id, ok: true, result });
    } catch (e) {
      send(s, { id, ok: false, error: e instanceof CtlError ? e.message : 'internal error' });
    } finally {
      clearTimeout(timer);
    }
  };

  const listener = Bun.listen<Conn>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(s) {
        s.data = { buf: '' };
        s.data.idle = setTimeout(() => s.end(), idleMs);
      },
      data(s, chunk) {
        const c = s.data;
        clearTimeout(c.idle);
        c.idle = setTimeout(() => s.end(), idleMs);
        c.buf += chunk.toString('utf8');
        let nl: number;
        while ((nl = c.buf.indexOf('\n')) >= 0) {
          const line = c.buf.slice(0, nl).trim();
          c.buf = c.buf.slice(nl + 1);
          if (line.length > CTL_MAX_LINE) {
            send(s, { id: null, ok: false, error: 'line too long' });
            s.end();
            return;
          }
          if (line !== '') void handle(line, s);
        }
        if (c.buf.length > CTL_MAX_LINE) {
          send(s, { id: null, ok: false, error: 'line too long' });
          s.end();
        }
      },
      close(s) {
        clearTimeout(s.data?.idle);
      },
      error() {},
    },
  });

  const endpoint: CtlEndpoint = { port: listener.port, token, pid: deps.pid };
  const file = ctlFile(opts.dir);
  try {
    mkdirSync(opts.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(endpoint));
    renameSync(tmp, file);
  } catch (e) {
    listener.stop(true);
    throw e;
  }
  return {
    ...endpoint,
    stop() {
      listener.stop(true);
      try {
        const cur = JSON.parse(readFileSync(file, 'utf8')) as Partial<CtlEndpoint>;
        if (cur.port === endpoint.port && cur.token === endpoint.token) rmSync(file, { force: true });
      } catch {
        /* missing or unreadable: nothing of ours to delete */
      }
    },
  };
}
