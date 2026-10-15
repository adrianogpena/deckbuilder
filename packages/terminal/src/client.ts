import { errorOf, request } from '@deckbuilder/ui';
import { TERMINAL_SOCKET_PATH } from './protocol.ts';
import type { SessionInfo, TerminalProfile, TerminalProfileInfo } from './protocol.ts';

export type { SessionInfo, TerminalProfile, TerminalProfileInfo };

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

/**
 * Opens a session. `profile` is a profile id (default: the `defaultProfile` setting); `dir` is an
 * absolute directory to start in (a missing one falls back to the profile/default cwd); `cwd` wins over both.
 */
export function openSession(opts: { cols: number; rows: number; cwd?: TerminalCwd; launch?: TerminalLaunch; profile?: string; dir?: string }): Promise<Ticketed> {
  const { cols, rows, cwd, launch, profile, dir } = opts;
  return request<Ticketed>('POST', '/api/terminal/open', {}, { cols, rows, root: cwd?.root, path: cwd?.path, launch, profile, dir });
}

/** Built-in profiles (installed shells, overrides applied), then custom ones. */
export function listProfiles(): Promise<TerminalProfileInfo[]> {
  return request<TerminalProfileInfo[]>('GET', '/api/terminal/profiles');
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
