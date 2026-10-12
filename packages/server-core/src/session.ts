import { randomBytes } from 'node:crypto';

export interface LaunchCodes {
  /** A new code for a launch URL. */
  issue(): string;
  /** True once per valid code; false when it is unknown, used or expired. */
  redeem(code: string): boolean;
}

const MAX_OUTSTANDING = 32;

/**
 * One-time codes that go in launch URLs instead of the session token: a URL that leaks
 * (browser history, command lines, terminal output) is useless once it was opened or expired.
 * `reusable` (dev only): the first code stays valid for the server's lifetime, so the printed
 * dev URL survives reloads.
 */
export function launchCodes({ ttlMs = 60_000, now = Date.now, reusable = false } = {}): LaunchCodes {
  const pending = new Map<string, number>();
  let fixed: string | null = null;

  return {
    issue() {
      if (reusable) return (fixed ??= randomBytes(16).toString('hex'));
      const code = randomBytes(16).toString('hex');
      pending.set(code, now() + ttlMs);
      // Map keeps insertion order: the first key is the oldest.
      while (pending.size > MAX_OUTSTANDING) pending.delete(pending.keys().next().value!);
      return code;
    },
    redeem(code) {
      if (reusable) return fixed !== null && code === fixed;
      const expires = pending.get(code);
      if (expires === undefined) return false;
      pending.delete(code);
      return now() <= expires;
    },
  };
}

export interface SocketTickets<T> {
  /** A one-time ticket that carries `data` to a WebSocket upgrade. */
  issue(data: T): string;
  /** The data once per valid ticket; undefined when it is unknown, used or expired. */
  redeem(ticket: string): T | undefined;
}

/**
 * One-time tickets for WebSocket upgrades: browsers can't set headers on a WebSocket and the session
 * token must not appear in a URL, so an authenticated call issues a ticket the socket URL carries.
 */
export function socketTickets<T>({ ttlMs = 30_000, now = Date.now } = {}): SocketTickets<T> {
  const pending = new Map<string, { data: T; expires: number }>();

  return {
    issue(data) {
      const ticket = randomBytes(16).toString('hex');
      pending.set(ticket, { data, expires: now() + ttlMs });
      while (pending.size > MAX_OUTSTANDING) pending.delete(pending.keys().next().value!);
      return ticket;
    },
    redeem(ticket) {
      const entry = pending.get(ticket);
      if (!entry) return undefined;
      pending.delete(ticket);
      return now() <= entry.expires ? entry.data : undefined;
    },
  };
}
