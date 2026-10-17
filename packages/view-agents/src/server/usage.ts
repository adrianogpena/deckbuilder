import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentAccountUsage, AgentRateLimit, AgentUsage } from '../protocol.ts';

/** Same folder naming as the statusLine script (`statusline/script.mjs.txt` `safeName`). */
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');

/** A usage file's content, or null when missing or not a usage object. */
export function readUsageFile(file: string): AgentUsage | null {
  try {
    const v: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!v || typeof v !== 'object') return null;
    const u = v as AgentUsage;
    return typeof u.sessionId === 'string' && typeof u.updatedAt === 'number' ? u : null;
  } catch {
    return null;
  }
}

/** One rate-limit window read at `updatedAt`; `resets_at` may be seconds or ms; a window already reset is dropped. */
function limitOf(w: { used_percentage?: number; resets_at?: number } | undefined, updatedAt: number, now: number): AgentRateLimit | undefined {
  if (!w || typeof w.used_percentage !== 'number' || !Number.isFinite(w.used_percentage)) return undefined;
  const r = typeof w.resets_at === 'number' && w.resets_at > 0 ? (w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at) : undefined;
  if (r !== undefined && r <= now) return undefined;
  return { percent: Math.max(0, Math.min(100, w.used_percentage)), resetsAt: r, updatedAt };
}

/** Context percent a usage file reports, when it has one. */
export function usageContextPercent(u: AgentUsage | undefined): number | undefined {
  const p = u?.context_window?.used_percentage;
  return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : undefined;
}

export const USAGE_MAX_AGE_MS = 9 * 24 * 60 * 60 * 1000;

/** Deletes usage files untouched for 9 days (run at startup); returns how many went. */
export function pruneUsage(root: string, now: number = Date.now()): number {
  let n = 0;
  try {
    for (const acc of readdirSync(root, { withFileTypes: true })) {
      if (!acc.isDirectory()) continue;
      for (const f of readdirSync(join(root, acc.name))) {
        const file = join(root, acc.name, f);
        try {
          if (now - statSync(file).mtimeMs > USAGE_MAX_AGE_MS) {
            rmSync(file, { force: true });
            n++;
          }
        } catch {
          /* gone or locked: skip */
        }
      }
    }
  } catch {
    /* no usage folder yet */
  }
  return n;
}

/** One rate-limit window of a record: its value, or undefined when absent. */
type Window = { used_percentage?: number; resets_at?: number } | undefined;
const hasValue = (w: Window): boolean => typeof w?.used_percentage === 'number' && Number.isFinite(w.used_percentage);

/**
 * Reads `<usageDir>/<account>/<sessionId>.json`, re-parsing only files whose mtime or size changed.
 * 5h / 7d per account: the freshest record that has a value for that window; records tagged with another
 * account's email are skipped (untagged ones count); a window whose reset time has passed is dropped.
 */
export function createUsageReader(usageDir: () => string | undefined, now: () => number = Date.now) {
  const cache = new Map<string, { mtime: number; size: number; usage: AgentUsage | null }>();
  return {
    read(accounts: Array<{ id: string; label: string; email?: string }>): { bySession: Map<string, AgentUsage>; accounts: AgentAccountUsage[] } {
      const bySession = new Map<string, AgentUsage>();
      const out: AgentAccountUsage[] = [];
      const root = usageDir();
      const seen = new Set<string>();
      if (!root) return { bySession, accounts: out };
      const t = now();
      for (const acc of accounts) {
        const dir = join(root, safeName(acc.id));
        let files: string[] = [];
        try {
          files = readdirSync(dir).filter((f) => f.endsWith('.json'));
        } catch {
          continue;
        }
        let five: AgentUsage | undefined;
        let seven: AgentUsage | undefined;
        for (const f of files) {
          const file = join(dir, f);
          seen.add(file);
          let st: { mtimeMs: number; size: number };
          try {
            st = statSync(file);
          } catch {
            continue;
          }
          let c = cache.get(file);
          if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
            c = { mtime: st.mtimeMs, size: st.size, usage: readUsageFile(file) };
            cache.set(file, c);
          }
          const u = c.usage;
          if (!u) continue;
          bySession.set(u.sessionId, u);
          if (u.email && acc.email && u.email !== acc.email) continue;
          if (hasValue(u.rate_limits?.five_hour) && (!five || u.updatedAt > five.updatedAt)) five = u;
          if (hasValue(u.rate_limits?.seven_day) && (!seven || u.updatedAt > seven.updatedAt)) seven = u;
        }
        const fiveHour = five && limitOf(five.rate_limits?.five_hour, five.updatedAt, t);
        const sevenDay = seven && limitOf(seven.rate_limits?.seven_day, seven.updatedAt, t);
        if (!fiveHour && !sevenDay) continue;
        const email = acc.email ?? five?.email ?? seven?.email;
        out.push({ account: acc.id, label: acc.label, updatedAt: Math.max(fiveHour?.updatedAt ?? 0, sevenDay?.updatedAt ?? 0), ...(email ? { email } : {}), fiveHour, sevenDay });
      }
      for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
      return { bySession, accounts: out };
    },
  };
}
