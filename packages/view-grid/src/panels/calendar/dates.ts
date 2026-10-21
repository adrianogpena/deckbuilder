/** Pure calendar-day math. A day is a `YYYY-MM-DD` key (local calendar day); arithmetic goes through UTC so DST never shifts it. */

export type WeekStart = 'mon' | 'sun';

const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** The key of a Date's local day. */
export const dayKey = (d: Date): string => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Milliseconds (UTC midnight) of a valid key, else NaN. */
export function keyMs(key: string): number {
  const m = KEY_RE.exec(key);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : NaN;
}

export const isKey = (key: string): boolean => !Number.isNaN(keyMs(key));

const msKey = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDays = (key: string, n: number): string => msKey(keyMs(key) + n * DAY_MS);

/** Whole days from `a` to `b` (negative when b is earlier). */
export const daysBetween = (a: string, b: string): number => Math.round((keyMs(b) - keyMs(a)) / DAY_MS);

/** 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (key: string): number => new Date(keyMs(key)).getUTCDay();

/** The key of the first day of the month `offset` months from the one holding `key`. */
export function addMonths(key: string, offset: number): string {
  const d = new Date(keyMs(key));
  return msKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

/** Six weeks of seven keys covering the month (`month0` is 0-11), starting on `weekStart`. */
export function monthMatrix(year: number, month0: number, weekStart: WeekStart): string[][] {
  const first = msKey(Date.UTC(year, month0, 1));
  const lead = (weekdayOf(first) - (weekStart === 'mon' ? 1 : 0) + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/** ISO 8601 week number (1-53) of a day. */
export function isoWeek(key: string): number {
  const ms = keyMs(key);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  const thursday = ms + (3 - weekday) * DAY_MS;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return Math.floor((thursday - yearStart) / (7 * DAY_MS)) + 1;
}

export interface SprintConfig {
  sprintStart: string;
  sprintLengthDays: number;
  cutoffDays: number;
}

export interface SprintInfo {
  /** 1-based count of sprints since `sprintStart`. */
  number: number;
  start: string;
  /** Last day of the sprint. */
  end: string;
  /** 1-based day of the sprint that `today` is. */
  day: number;
  length: number;
  /** The cut-off day, or null when `cutoffDays` is 0 or it falls before the sprint. */
  cutoff: string | null;
  /** Days after `today` up to and including the last day. */
  daysLeft: number;
}

/** The sprint containing `today`, or null without a valid start or before the first sprint. */
export function sprintInfo(config: SprintConfig, today: string): SprintInfo | null {
  const length = Math.floor(config.sprintLengthDays);
  if (!isKey(config.sprintStart) || !(length >= 1)) return null;
  const offset = daysBetween(config.sprintStart, today);
  if (offset < 0) return null;
  const index = Math.floor(offset / length);
  const start = addDays(config.sprintStart, index * length);
  const end = addDays(start, length - 1);
  const cutoff = config.cutoffDays > 0 ? addDays(end, -Math.floor(config.cutoffDays)) : null;
  return {
    number: index + 1,
    start,
    end,
    day: offset - index * length + 1,
    length,
    cutoff: cutoff !== null && daysBetween(start, cutoff) >= 0 ? cutoff : null,
    daysLeft: daysBetween(today, end),
  };
}

/** Whether `key` is inside the sprint. */
export const inSprint = (info: SprintInfo | null, key: string): boolean => info !== null && key >= info.start && key <= info.end;

/** The Monday-Friday days of the sprint, in order. */
export function sprintWorkingDays(info: SprintInfo): string[] {
  const days: string[] = [];
  for (let i = 0; i < info.length; i++) {
    const key = addDays(info.start, i);
    const wd = weekdayOf(key);
    if (wd !== 0 && wd !== 6) days.push(key);
  }
  return days;
}

/** "Sprint {n}" with `{n}` replaced; an empty pattern gives the number alone. */
export const sprintName = (pattern: string, n: number): string => (pattern.trim() ? pattern.replace(/\{n\}/g, String(n)) : String(n));

export interface DatedLabel {
  date: string;
  label: string;
}

/** Lines `YYYY-MM-DD | label`; lines with an invalid date are skipped, a missing label stays empty. Sorted by date. */
export function parseDated(text: string): DatedLabel[] {
  const out: DatedLabel[] = [];
  for (const line of text.split(/\r?\n/)) {
    const bar = line.indexOf('|');
    const date = (bar < 0 ? line : line.slice(0, bar)).trim();
    if (!isKey(date)) continue;
    out.push({ date, label: bar < 0 ? '' : line.slice(bar + 1).trim() });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
