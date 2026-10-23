export const NO_TICKET = '(no ticket)';
export const GAP_CAP_MS = 15 * 60 * 1000;

export interface DayCell {
  hours: number;
  commits: number;
}

export type DayTable = Record<string, Record<string, DayCell>>;

export interface TimesheetData {
  /** Monday of the stored week, `YYYY-MM-DD`. */
  week: string;
  days: DayTable;
  lockedDays: string[];
}

export interface WeekBounds {
  monday: string;
  /** Monday to Friday. */
  days: string[];
}

export interface Rec {
  ts: number;
  ticket: string | null;
}

export interface Commit {
  day: string;
  ticket: string | null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in local time. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/** Monday to Friday of the week holding `now`, local time. */
export function weekBounds(now: Date): WeekBounds {
  const today = localDay(now);
  const monday = addDays(today, -((parseDay(today).getDay() + 6) % 7));
  return { monday, days: Array.from({ length: 5 }, (_, i) => addDays(monday, i)) };
}

/** Finds a ticket key in text, case-insensitive, upper-cased; null when none or the pattern is invalid. */
export function makeTicketFinder(pattern: string): (text: string | null | undefined) => string | null {
  let re: RegExp;
  try {
    re = new RegExp(`\\b(${pattern})[a-zA-Z]?\\b`, 'i');
  } catch {
    return () => null;
  }
  return (text) => {
    if (!text) return null;
    const m = re.exec(text);
    return m?.[1] ? m[1].toUpperCase() : null;
  };
}

/** Sum of the gaps between consecutive timestamps, each capped at 15 minutes, in hours. */
export function activeHours(timestamps: readonly number[]): number {
  const sorted = [...timestamps].sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < sorted.length; i++) ms += Math.min((sorted[i] as number) - (sorted[i - 1] as number), GAP_CAP_MS);
  return ms / 3_600_000;
}

/** Claude Code names a project dir after its path with `:`, `\` and `/` replaced by `-`. */
export const encodeRoot = (root: string): string => root.trim().replace(/[:\\/]/g, '-').toUpperCase();

const slashes = (p: string): string => p.replace(/\\/g, '/');

export const splitRoots = (text: string): string[] =>
  text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);

export function isTracked(cwd: string, roots: readonly string[]): boolean {
  const n = slashes(cwd).toUpperCase();
  return roots.some((r) => n.startsWith(slashes(r).toUpperCase()));
}

/** A Copilot worktree `<root>/copilot-worktrees/<repo>/<slug>` collapses to `<root>/<repo>`. */
export function collapseCopilotWorktree(cwd: string): string {
  const n = slashes(cwd);
  const m = /^(.*)\/copilot-worktrees\/([^/]+)\/[^/]+\/?$/i.exec(n);
  return m ? `${m[1]}/${m[2]}` : n;
}

/** Flat `key: value` YAML; a block scalar (`|-`, `>`) is joined into one line. */
export function parseSimpleYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key) continue;
    if (/^[|>][+-]?$/.test(val)) {
      const indent = line.length - line.trimStart().length;
      const block: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] as string;
        if (next.trim() === '') {
          block.push('');
          i++;
          continue;
        }
        if (next.length - next.trimStart().length <= indent) break;
        block.push(next.trim());
        i++;
      }
      while (block.length && block[block.length - 1] === '') block.pop();
      val = block.join(' ').trim();
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export interface ClaudeScan {
  feed(line: string): void;
  /** Records of the week, with the ticket from the branch or, failing that, the session titles. */
  result(): { records: Rec[]; cwd: string | null };
}

/** Reads one Claude Code session file line by line (the caller streams it). */
export function createClaudeScan(roots: readonly string[], findTicket: (t: string | null | undefined) => string | null, inWeek: (day: string) => boolean): ClaudeScan {
  const records: Rec[] = [];
  let branch: string | null = null;
  let cwd: string | null = null;
  let tracked: string | null = null;
  const titles: { custom?: string; ai?: string } = {};
  return {
    feed(line) {
      if (!line) return;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (!isObject(obj)) return;
      if (obj.type === 'custom-title') titles.custom = str(obj.customTitle) ?? titles.custom;
      if (obj.type === 'ai-title') titles.ai = str(obj.aiTitle) ?? titles.ai;
      branch = str(obj.gitBranch) ?? branch;
      cwd = str(obj.cwd) ?? cwd;
      const stamp = str(obj.timestamp);
      if (!stamp) return;
      const ts = new Date(stamp).getTime();
      if (Number.isNaN(ts) || !inWeek(localDay(new Date(ts)))) return;
      if (!cwd || !isTracked(cwd, roots)) return;
      tracked = cwd;
      records.push({ ts, ticket: findTicket(branch) });
    },
    result() {
      const fallback = findTicket(titles.custom) ?? findTicket(titles.ai);
      return { records: records.map((r) => (r.ticket ? r : { ...r, ticket: fallback })), cwd: tracked };
    },
  };
}

/** Records of one Copilot session: every event with a `timestamp` in the week gets the session's ticket. */
export function copilotRecords(lines: Iterable<string>, ticket: string | null, inWeek: (day: string) => boolean): Rec[] {
  const out: Rec[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      const obj: unknown = JSON.parse(line);
      const stamp = isObject(obj) ? str(obj.timestamp) : undefined;
      if (!stamp) continue;
      const ts = new Date(stamp).getTime();
      if (!Number.isNaN(ts) && inWeek(localDay(new Date(ts)))) out.push({ ts, ticket });
    } catch {}
  }
  return out;
}

const round2 = (n: number): number => Number(n.toFixed(2));

/** Hours per day and ticket from the records, plus commit counts attached to tickets that have entries that week. */
export function buildDays(records: readonly Rec[], commits: readonly Commit[], weekDays: readonly string[]): DayTable {
  const times = new Map<string, Map<string, number[]>>();
  for (const r of records) {
    const day = localDay(new Date(r.ts));
    if (!weekDays.includes(day)) continue;
    const byTicket = times.get(day) ?? new Map<string, number[]>();
    times.set(day, byTicket);
    const key = r.ticket ?? NO_TICKET;
    byTicket.set(key, [...(byTicket.get(key) ?? []), r.ts]);
  }
  const days: DayTable = {};
  const known = new Set<string>();
  for (const day of weekDays) {
    const cells: Record<string, DayCell> = {};
    for (const [ticket, ts] of times.get(day) ?? []) {
      cells[ticket] = { hours: round2(activeHours(ts)), commits: 0 };
      known.add(ticket);
    }
    days[day] = cells;
  }
  for (const c of commits) {
    const cells = days[c.day];
    const ticket = c.ticket ?? NO_TICKET;
    if (!cells || !known.has(ticket)) continue;
    const cell = cells[ticket] ?? (cells[ticket] = { hours: 0, commits: 0 });
    cell.commits += 1;
  }
  return days;
}

export const emptyData = (): TimesheetData => ({ week: '', days: {}, lockedDays: [] });

/**
 * Merges fresh numbers into the stored week. Today and future days always take fresh data; a locked
 * past day keeps what is stored; an unlocked past day takes fresh data once and is then locked.
 * Stored data of another week is discarded.
 */
export function applyLocks(stored: TimesheetData, fresh: DayTable, bounds: WeekBounds, today: string): TimesheetData {
  const same = stored.week === bounds.monday;
  const locked = new Set(same ? stored.lockedDays : []);
  const days: DayTable = {};
  for (const day of bounds.days) {
    if (day >= today) {
      days[day] = fresh[day] ?? {};
    } else if (locked.has(day) && same) {
      days[day] = stored.days[day] ?? {};
    } else {
      days[day] = fresh[day] ?? {};
      locked.add(day);
    }
  }
  return { week: bounds.monday, days, lockedDays: [...locked].sort() };
}

/** Flips the lock of a past day of the stored week; other days and weeks are left as they are. */
export function toggleLock(stored: TimesheetData, date: string, bounds: WeekBounds, today: string): TimesheetData {
  if (stored.week !== bounds.monday || !bounds.days.includes(date) || date >= today) return stored;
  const locked = new Set(stored.lockedDays);
  if (!locked.delete(date)) locked.add(date);
  return { ...stored, lockedDays: [...locked].sort() };
}

/** Total hours per ticket of the stored week. */
export function weekTotals(data: TimesheetData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cells of Object.values(data.days)) {
    for (const [ticket, c] of Object.entries(cells)) out[ticket] = round2((out[ticket] ?? 0) + c.hours);
  }
  return out;
}

/** Cleans what was read from disk. */
export function parseData(raw: unknown): TimesheetData {
  if (!isObject(raw) || typeof raw.week !== 'string' || !isObject(raw.days)) return emptyData();
  const days: DayTable = {};
  for (const [day, cells] of Object.entries(raw.days)) {
    if (!isObject(cells)) continue;
    const out: Record<string, DayCell> = {};
    for (const [ticket, c] of Object.entries(cells)) {
      if (!isObject(c)) continue;
      out[ticket] = { hours: typeof c.hours === 'number' ? c.hours : 0, commits: typeof c.commits === 'number' ? c.commits : 0 };
    }
    days[day] = out;
  }
  const lockedDays = Array.isArray(raw.lockedDays) ? raw.lockedDays.filter((d): d is string => typeof d === 'string') : [];
  return { week: raw.week, days, lockedDays };
}
