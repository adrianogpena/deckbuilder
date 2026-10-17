import { readdirSync, readFileSync, statSync } from 'node:fs';
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

/** One rate-limit window; `resets_at` may be seconds or ms; a window already reset counts as 0 %. */
function limitOf(w: { used_percentage?: number; resets_at?: number } | undefined, now: number): AgentRateLimit | undefined {
  if (!w || typeof w.used_percentage !== 'number' || !Number.isFinite(w.used_percentage)) return undefined;
  const r = typeof w.resets_at === 'number' && w.resets_at > 0 ? (w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at) : undefined;
  if (r !== undefined && r <= now) return { percent: 0 };
  return { percent: Math.max(0, Math.min(100, w.used_percentage)), resetsAt: r };
}

/** Context percent a usage file reports, when it has one. */
export function usageContextPercent(u: AgentUsage | undefined): number | undefined {
  const p = u?.context_window?.used_percentage;
  return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : undefined;
}

/** Reads `<usageDir>/<account>/<sessionId>.json`, re-parsing only files whose mtime changed. */
export function createUsageReader(usageDir: () => string | undefined, now: () => number = Date.now) {
  const cache = new Map<string, { mtime: number; usage: AgentUsage | null }>();
  return {
    read(accounts: Array<{ id: string; label: string }>): { bySession: Map<string, AgentUsage>; accounts: AgentAccountUsage[] } {
      const bySession = new Map<string, AgentUsage>();
      const out: AgentAccountUsage[] = [];
      const root = usageDir();
      const seen = new Set<string>();
      if (!root) return { bySession, accounts: out };
      for (const acc of accounts) {
        const dir = join(root, safeName(acc.id));
        let files: string[] = [];
        try {
          files = readdirSync(dir).filter((f) => f.endsWith('.json'));
        } catch {
          continue;
        }
        let newest: AgentUsage | undefined;
        for (const f of files) {
          const file = join(dir, f);
          seen.add(file);
          let mtime: number;
          try {
            mtime = statSync(file).mtimeMs;
          } catch {
            continue;
          }
          let c = cache.get(file);
          if (!c || c.mtime !== mtime) {
            c = { mtime, usage: readUsageFile(file) };
            cache.set(file, c);
          }
          const u = c.usage;
          if (!u) continue;
          bySession.set(u.sessionId, u);
          if (u.rate_limits && (!newest || u.updatedAt > newest.updatedAt)) newest = u;
        }
        if (!newest?.rate_limits) continue;
        const t = now();
        const fiveHour = limitOf(newest.rate_limits.five_hour, t);
        const sevenDay = limitOf(newest.rate_limits.seven_day, t);
        if (fiveHour || sevenDay) out.push({ account: acc.id, label: acc.label, updatedAt: newest.updatedAt, fiveHour, sevenDay });
      }
      for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
      return { bySession, accounts: out };
    },
  };
}
