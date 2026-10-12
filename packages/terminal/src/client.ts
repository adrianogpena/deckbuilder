import { errorOf, request } from '@deckbuilder/ui';
import { TERMINAL_SOCKET_PATH } from './protocol.ts';
import type { SessionInfo } from './protocol.ts';

export type { SessionInfo };

/** A project directory: a root id and a path relative to it. */
export interface TerminalCwd {
  root: string;
  path: string;
}

/** A program the app registered on the server, with the args its launcher validates. */
export interface TerminalLaunch {
  id: string;
  args?: unknown;
}

export interface Ticketed {
  session: string;
  ticket: string;
}

export function openSession(opts: { cols: number; rows: number; cwd?: TerminalCwd; launch?: TerminalLaunch }): Promise<Ticketed> {
  const { cols, rows, cwd, launch } = opts;
  return request<Ticketed>('POST', '/api/terminal/open', {}, { cols, rows, root: cwd?.root, path: cwd?.path, launch });
}

export function attachSession(session: string, view: 'interactive' | 'preview' = 'interactive'): Promise<Ticketed> {
  return request<Ticketed>('POST', '/api/terminal/attach', {}, { session, view });
}

/** Kills a session (a tab close). Unknown ids are a no-op. */
export async function closeSession(session: string): Promise<void> {
  await request('POST', '/api/terminal/close', {}, { session });
}

export function listSessions(): Promise<SessionInfo[]> {
  return request<SessionInfo[]>('GET', '/api/terminal/sessions');
}

/** True for the error `attach` throws when the session is gone. */
export const isSessionGone = (err: unknown): boolean => errorOf(err).code === 'terminalSession';

/** The socket URL for a ticket, on the page's own origin. */
export function socketUrl(ticket: string, loc: { protocol: string; host: string } = location): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}${TERMINAL_SOCKET_PATH}?t=${encodeURIComponent(ticket)}`;
}
