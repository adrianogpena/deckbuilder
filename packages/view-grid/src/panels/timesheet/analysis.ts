export const NO_TICKET = '(no ticket)';
/** Default longest gap between two records that still counts as work. */
export const IDLE_MINUTES = 15;

export interface DayCell {
  hours: number;
  commits: number;
}

export type DayTable = Record<string, Record<string, DayCell>>;

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

/** Claude Code names a project dir after its path with `:`, `\` and `/` replaced by `-`. */
export const encodeRoot = (root: string): string => root.trim().replace(/[:\\/]/g, '-').toUpperCase();

const slashes = (p: string): string => p.replace(/\\/g, '/');

/** A Git Bash or WSL drive path (`/x/Source`, `/mnt/x/Source`) becomes `X:/Source`. */
export function normalizeRoot(root: string): string {
  const n = slashes(root.trim());
  const m = /^(?:\/mnt)?\/([a-zA-Z])(\/.*)?$/.exec(n);
  return m ? `${(m[1] as string).toUpperCase()}:${m[2] ?? '/'}` : n;
}

export const splitRoots = (text: string): string[] =>
  text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean).map(normalizeRoot);

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

/** How many typed prompts of a session are searched for a ticket key. */
const PROMPTS_SEARCHED = 5;

/** One Claude Code session of the week: each record keeps the ticket of its branch; the rest decides the fallback. */
export interface ClaudeSession {
  records: Rec[];
  /** Ticket of the title set with `/rename`. */
  custom: string | null;
  /** Ticket of the generated title. */
  ai: string | null;
  /** First ticket of each of the first typed prompts, in order. */
  prompts: string[];
  /** Ticket in the name of the session's folder. */
  folder: string | null;
  /** The last tracked working folder, or null when no record is in the week. */
  cwd: string | null;
}

export interface ClaudeScan {
  /** Feeds one line of the session file or of one of its subagent files (the caller streams them). */
  feed(line: string): void;
  result(): ClaudeSession;
}

/** Text the user typed: a string prompt, or the text blocks of a prompt marked human. */
function typedText(obj: Record<string, unknown>): string | null {
  if (obj.type !== 'user' || obj.isSidechain === true || !isObject(obj.message)) return null;
  const content = obj.message.content;
  if (typeof content === 'string') return content;
  if (!isObject(obj.origin) || obj.origin.kind !== 'human' || !Array.isArray(content)) return null;
  return content.map((b) => (isObject(b) && b.type === 'text' ? str(b.text) ?? '' : '')).join('\n');
}

export function createClaudeScan(roots: readonly string[], findTicket: (t: string | null | undefined) => string | null, inWeek: (day: string) => boolean): ClaudeScan {
  const records: Rec[] = [];
  const prompts: string[] = [];
  let typed = 0;
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
      const text = typed < PROMPTS_SEARCHED ? typedText(obj) : null;
      if (text !== null) {
        typed++;
        const key = findTicket(text);
        if (key) prompts.push(key);
      }
      const stamp = str(obj.timestamp);
      if (!stamp) return;
      const ts = new Date(stamp).getTime();
      if (Number.isNaN(ts) || !inWeek(localDay(new Date(ts)))) return;
      if (!cwd || !isTracked(cwd, roots)) return;
      tracked = cwd;
      records.push({ ts, ticket: findTicket(branch) });
    },
    result() {
      const folder = tracked ? findTicket(slashes(tracked).replace(/\/+$/, '').split('/').pop()) : null;
      return { records, custom: findTicket(titles.custom), ai: findTicket(titles.ai), prompts, folder, cwd: tracked };
    },
  };
}

/** `VWDE` of `VWDE-123`. */
export const keyPrefix = (key: string): string => key.slice(0, key.lastIndexOf('-'));

/** Prefixes of the keys the user named on purpose: branches and custom titles of the sessions, and commit subjects. */
export function knownPrefixes(sessions: readonly ClaudeSession[], commits: readonly Commit[]): Set<string> {
  const out = new Set<string>();
  const add = (k: string | null) => {
    if (k) out.add(keyPrefix(k));
  };
  for (const s of sessions) {
    add(s.custom);
    for (const r of s.records) add(r.ticket);
  }
  for (const c of commits) add(c.ticket);
  return out;
}

/**
 * Records of a session with a ticket each. A record without a branch ticket takes, in order: the custom title's
 * ticket, the session's most used branch ticket, then a typed prompt's, the folder's and the generated title's
 * ticket, these last three only when their prefix is in `known` (so `UTF-8` or `test-12` are not taken for tickets).
 */
export function resolveSession(s: ClaudeSession, known: ReadonlySet<string>): Rec[] {
  const counts = new Map<string, number>();
  for (const r of s.records) if (r.ticket) counts.set(r.ticket, (counts.get(r.ticket) ?? 0) + 1);
  let main: string | null = null;
  for (const [t, n] of counts) if (!main || n > (counts.get(main) as number)) main = t;
  const ok = (k: string | null | undefined): string | null => (k && known.has(keyPrefix(k)) ? k : null);
  const fallback = s.custom ?? main ?? ok(s.prompts.find((k) => ok(k))) ?? ok(s.folder) ?? ok(s.ai);
  return s.records.map((r) => (r.ticket ? r : { ...r, ticket: fallback }));
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

/**
 * Hours per ticket of one day. All records share one timeline, so parallel sessions are not counted twice: each gap
 * between consecutive records goes to the ticket of the earlier one when it is at most `idleMs`, and counts nothing
 * when longer (a break). Every ticket with a record gets an entry, even at 0 hours.
 */
export function dayHours(records: readonly Rec[], idleMs: number): Map<string, number> {
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const ms = new Map<string, number>();
  sorted.forEach((r, i) => {
    const key = r.ticket ?? NO_TICKET;
    if (!ms.has(key)) ms.set(key, 0);
    const next = sorted[i + 1];
    const gap = next ? next.ts - r.ts : Infinity;
    if (gap <= idleMs) ms.set(key, (ms.get(key) as number) + gap);
  });
  return new Map([...ms].map(([t, v]) => [t, v / 3_600_000]));
}

/** Hours per day and ticket from the records, plus commit counts attached to tickets that have entries that week. */
export function buildDays(records: readonly Rec[], commits: readonly Commit[], weekDays: readonly string[], idleMs: number): DayTable {
  const byDay = new Map<string, Rec[]>();
  for (const r of records) {
    const day = localDay(new Date(r.ts));
    if (!weekDays.includes(day)) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const days: DayTable = {};
  const known = new Set<string>();
  for (const day of weekDays) {
    const cells: Record<string, DayCell> = {};
    for (const [ticket, hours] of dayHours(byDay.get(day) ?? [], idleMs)) {
      cells[ticket] = { hours: round2(hours), commits: 0 };
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
