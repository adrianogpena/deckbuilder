/** Elapsed time as "now", "3m", "2h", "5d" (locale-free); a future date counts as "now". */
export function relTime(date: Date | number | string, now: Date | number = Date.now()): string {
  const ms = new Date(now).getTime() - new Date(date).getTime();
  if (!Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 365) return `${d}d`;
  return `${Math.floor(d / 365)}y`;
}

/** A duration in ms as "850ms", "12s", "3m 05s", "1h 02m". */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Whether a `multi` field of `config` has `column` ticked. */
export function hasColumn(config: Record<string, unknown>, key: string, column: string): boolean {
  const v = config[key];
  return Array.isArray(v) && v.includes(column);
}
