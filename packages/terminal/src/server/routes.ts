import { AppError, invalid, isRecord, notFound, socketTickets, type Routes, type SocketData, type SocketRoutes } from '@deckbuilder/server-core';
import type { ServerWebSocket } from 'bun';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { decodeClientMessage, MAX_COLS, MAX_ROWS, TERMINAL_SOCKET_PATH } from '../protocol.ts';
import type { Launchers } from './launchers.ts';
import { availableShells, isShellId, resolveShell, type ShellId, type ShellLookup } from './shells.ts';
import type { Sink, TerminalSessions, ViewKind } from './sessions.ts';

/** Sockets with more than this queued are closed with BACKPRESSURE_CLOSE instead of buffering without bound. */
export const MAX_BUFFERED = 1024 * 1024;
export const BACKPRESSURE_CLOSE = 4001;

export interface TerminalRoutesOptions {
  sessions: TerminalSessions;
  /** The configured shell id (the `terminal.shell` setting); anything but a known id means `auto`. */
  shell: () => Promise<string>;
  /** Resolves a project root id and relative path to an existing directory, or throws. Required for `root`. */
  resolveCwd?: (root: string, path: string) => Promise<string>;
  launchers?: Launchers;
  /** Where shells are looked up; tests replace it. */
  lookup?: ShellLookup;
}

interface Ticket {
  session: string;
  view: ViewKind;
}

const badRequest = () => invalid('badRequest', 'Invalid request.');

function size(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw badRequest();
  return v;
}

function sessionId(b: Record<string, unknown>): string {
  if (typeof b.session !== 'string' || !b.session) throw badRequest();
  return b.session;
}

export function terminalRoutes(opts: TerminalRoutesOptions): { routes: Routes; sockets: SocketRoutes } {
  const { sessions } = opts;
  const lookup: ShellLookup = opts.lookup ?? { platform: process.platform, env: process.env, exists: existsSync };
  const tickets = socketTickets<Ticket>();

  async function pickShell(): Promise<{ id: ShellId; argv: string[] }> {
    const configured = await opts.shell();
    const id = isShellId(configured) ? configured : 'auto';
    const argv = resolveShell(id, lookup);
    if (argv) return { id, argv };
    const fallback = resolveShell('auto', lookup);
    if (!fallback) throw invalid('terminalNoShell', 'No shell found on this machine.');
    return { id: 'auto', argv: fallback };
  }

  async function cwdOf(root: unknown, path: unknown): Promise<string> {
    if (root === undefined) return homedir();
    if (typeof root !== 'string' || (path !== undefined && typeof path !== 'string')) throw badRequest();
    if (!opts.resolveCwd) throw invalid('notADirectory', 'Working directories are not available.');
    return opts.resolveCwd(root, path ?? '');
  }

  const routes: Routes = {
    'POST /api/terminal/open': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      const cols = size(b.cols, MAX_COLS);
      const rows = size(b.rows, MAX_ROWS);
      if (b.launch !== undefined && (!isRecord(b.launch) || typeof b.launch.id !== 'string')) throw badRequest();
      const shell = await pickShell();
      let cmd = shell.argv;
      let label: string = shell.id === 'auto' ? 'shell' : shell.id;
      let env: Record<string, string> | undefined;
      let launcher: string | undefined;
      let meta: Record<string, unknown> | undefined;
      if (b.launch !== undefined) {
        const resolved = opts.launchers?.resolve((b.launch as Record<string, unknown>).id, (b.launch as Record<string, unknown>).args, {
          shell: shell.argv,
        });
        if (!resolved) throw invalid('terminalLauncher', 'Unknown or invalid launcher.');
        ({ cmd, env, label, meta, launcher } = resolved);
      }
      const cwd = await cwdOf(b.root, b.path);
      const session = sessions.create({ cmd, cwd, cols, rows, env, label, launcher, meta });
      return { session: session.id, ticket: tickets.issue({ session: session.id, view: 'interactive' }) };
    },

    'POST /api/terminal/attach': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      const id = sessionId(b);
      if (b.view !== undefined && b.view !== 'interactive' && b.view !== 'preview') throw badRequest();
      if (!sessions.get(id)) throw notFound('terminalSession', 'No such terminal session');
      return { session: id, ticket: tickets.issue({ session: id, view: b.view ?? 'interactive' }) };
    },

    'POST /api/terminal/close': async ({ json }) => {
      sessions.close(sessionId(await json<Record<string, unknown>>()));
      return { ok: true };
    },

    'POST /api/terminal/label': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      if (typeof b.label !== 'string') throw badRequest();
      sessions.setLabel(sessionId(b), b.label);
      return { ok: true };
    },

    'GET /api/terminal/sessions': () => sessions.list(),
    'GET /api/terminal/shells': () => availableShells(lookup),
    'GET /api/terminal/launchers': () => opts.launchers?.list() ?? [],
  };

  const sinks = new WeakMap<ServerWebSocket<SocketData>, { session: string; sink: Sink }>();

  const sockets: SocketRoutes = {
    [TERMINAL_SOCKET_PATH]: {
      tickets,
      open(ws, { session, view }: Ticket) {
        const sink: Sink = {
          send(frame) {
            if (ws.getBufferedAmount() > MAX_BUFFERED) {
              sessions.detach(session, sink);
              ws.close(BACKPRESSURE_CLOSE, 'backpressure');
              return;
            }
            ws.send(frame);
          },
          close: () => ws.close(),
        };
        sinks.set(ws, { session, sink });
        try {
          sessions.attach(session, sink, view);
        } catch (e) {
          sinks.delete(ws);
          if (!(e instanceof AppError) || e.code !== 'terminalSession') {
            console.error('terminal attach failed', e);
            ws.close(1011, 'error');
            return;
          }
          ws.close(1008, 'noSession');
        }
      },
      message(ws, msg) {
        const attached = sinks.get(ws);
        if (!attached) return;
        const decoded = decodeClientMessage(msg);
        if (!decoded) return;
        if (decoded.kind === 'input') sessions.write(attached.session, attached.sink, decoded.data);
        else if (decoded.msg.type === 'resize') sessions.resize(attached.session, attached.sink, decoded.msg.cols, decoded.msg.rows);
        else sessions.close(attached.session, attached.sink);
      },
      close(ws) {
        const attached = sinks.get(ws);
        if (!attached) return;
        sinks.delete(ws);
        sessions.detach(attached.session, attached.sink);
      },
    },
  };

  return { routes, sockets };
}
