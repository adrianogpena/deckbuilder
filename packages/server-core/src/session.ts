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
