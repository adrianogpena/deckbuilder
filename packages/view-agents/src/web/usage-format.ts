// Pure usage formatting (no `../i18n` import: it breaks bun tests).
import type { AgentCacheState, AgentRateLimit } from '../protocol.ts';

export type UsageMetric = 'context' | 'fiveHour' | 'sevenDay';
export type Severity = 'ok' | 'warn' | 'err';

/** Warning / critical thresholds per metric (percent). */
export const SEVERITY_AT: Record<UsageMetric, readonly [number, number]> = {
  context: [20, 50],
  fiveHour: [50, 80],
  sevenDay: [70, 90],
};

/** A 5h / 7d reading older than this is dimmed; context never is. */
export const STALE_MS = 15 * 60_000;
export const BAR_CELLS = 10;

export const clampPercent = (p: number): number => (Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0);

/** Percent as shown: clamped, rounded. */
export const shownPercent = (p: number): number => Math.round(clampPercent(p));

export function severity(metric: UsageMetric, percent: number): Severity {
  const [warn, crit] = SEVERITY_AT[metric];
  const p = clampPercent(percent);
  return p >= crit ? 'err' : p >= warn ? 'warn' : 'ok';
}

/** Filled cells of a 10-cell bar (fill rounded). */
export const barCells = (percent: number, cells: number = BAR_CELLS): number => Math.round((clampPercent(percent) / 100) * cells);

export const isStale = (updatedAt: number | undefined, now: number): boolean => updatedAt !== undefined && now - updatedAt > STALE_MS;

/** The window, or undefined once its reset time has passed. */
export const liveLimit = (limit: AgentRateLimit | undefined, now: number): AgentRateLimit | undefined =>
  limit && (limit.resetsAt === undefined || limit.resetsAt > now) ? limit : undefined;

/** Reset label: 5h shows the time only ('8:30 PM' / '20:30'); 7d prefixes the weekday ('Mon 20:30'). */
export function resetLabel(resetsAt: number, metric: 'fiveHour' | 'sevenDay', use24h: boolean): string {
  const d = new Date(resetsAt);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: use24h ? 'h23' : 'h12' }).format(d);
  if (metric === 'fiveHour') return time;
  return `${new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)} ${time}`;
}

/** Short elapsed time: '45s', '12m', '3h', '2d'. */
export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Prompt cache: while warm, whole minutes left (rounded up); once expired, the time since the last request. */
export function cacheState(cache: AgentCacheState, now: number): { warm: true; minutesLeft: number } | { warm: false; since: string } {
  const left = cache.lastRequestAt + cache.ttlMs - now;
  if (left > 0) return { warm: true, minutesLeft: Math.ceil(left / 60_000) };
  return { warm: false, since: shortDuration(now - cache.lastRequestAt) };
}

/** 'Model · effort', the model alone without an effort, or undefined without a model. */
export function modelLine(model: string | undefined, effort: string | undefined): string | undefined {
  if (!model) return undefined;
  return effort ? `${model} · ${effort}` : model;
}

/** The startup baseline worth showing: only when the current context is above it. */
export const startupShown = (context: number | undefined, startup: number | undefined): number | undefined =>
  context !== undefined && startup !== undefined && shownPercent(context) > shownPercent(startup) ? shownPercent(startup) : undefined;

/** Local calendar day of a timestamp: 'YYYY-MM-DD' (same key as `server/usage-history.ts`). */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The last `count` local days, latest first: two-letter weekday and the 7d spend that day (undefined = no data). */
export function historyRows(days: Record<string, number> | undefined, now: number, count = 5): Array<{ day: string; weekday: string; percent?: number }> {
  const today = new Date(now);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const day = localDayKey(d.getTime());
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d).slice(0, 2);
    const percent = days?.[day];
    return percent === undefined ? { day, weekday } : { day, weekday, percent };
  });
}
