/**
 * Minimal iCalendar reader: VEVENT with DTSTART / DTEND / SUMMARY / LOCATION / URL, RRULE
 * (FREQ DAILY / WEEKLY / MONTHLY, INTERVAL, COUNT, UNTIL, BYDAY for weekly) and EXDATE.
 * Occurrences are expanded only inside the requested window. Pure; no I/O.
 */
import { addDays, daysBetween, dayKey, isKey, keyMs, weekdayOf } from './dates';

export interface IcsEvent {
  summary: string;
  /** All-day: the first day as `YYYY-MM-DD`; else the start instant as an ISO string. */
  start: string;
  /** All-day: the day after the last day (exclusive, as in iCalendar); else the end instant (equal to `start` without DTEND). */
  end: string;
  allDay: boolean;
  location?: string;
  url?: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** A date or date-time as written in the file: wall-clock parts plus the zone they are in (`undefined`: floating, local). */
interface Stamp {
  allDay: boolean;
  /** `YYYY-MM-DD`. */
  key: string;
  /** Seconds since midnight (0 for all-day). */
  secs: number;
  zone?: string;
}

const MAX_EVENTS = 2000;
const MAX_ITERATIONS = 20_000;

/** Joins continuation lines (a line starting with a space or tab continues the previous one). */
export const unfold = (text: string): string[] =>
  text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter((l) => l.length > 0);

const unescapeText = (v: string): string => v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/** `NAME;P=V;P2="v:2":value`; null for a line without a colon. */
export function parseLine(line: string): Prop | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon).match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const name = (head[0] ?? '').toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(colon + 1) };
}

function zoneOk(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parseStamp(prop: Prop): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(prop.value.trim());
  if (!m) return null;
  const key = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isKey(key)) return null;
  if (m[4] === undefined || prop.params.VALUE === 'DATE') return { allDay: true, key, secs: 0 };
  const secs = Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0);
  if (m[7]) return { allDay: false, key, secs, zone: 'UTC' };
  const tz = prop.params.TZID;
  return { allDay: false, key, secs, zone: tz && zoneOk(tz) ? tz : undefined };
}

/** Offset in ms of `zone` from UTC at the instant `ms`. */
function zoneOffset(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a stamp's wall time is, in its zone (local time for a floating or all-day stamp). */
function instantOf(key: string, secs: number, zone: string | undefined): number {
  const wall = keyMs(key) + secs * 1000;
  if (zone === 'UTC') return wall;
  if (zone) {
    let guess = wall - zoneOffset(wall, zone);
    guess = wall - zoneOffset(guess, zone);
    return guess;
  }
  const [y, mo, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, 0, 0, secs).getTime();
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  count: number;
  until: Stamp | null;
  byDay: number[];
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseRule(value: string, params: Record<string, string>): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
  const interval = Math.max(1, Math.floor(Number(kv.INTERVAL ?? 1)) || 1);
  const count = kv.COUNT ? Math.max(0, Math.floor(Number(kv.COUNT)) || 0) : Infinity;
  const until = kv.UNTIL ? parseStamp({ name: 'UNTIL', params, value: kv.UNTIL }) : null;
  const byDay = (kv.BYDAY ?? '')
    .split(',')
    .map((d) => DAY_CODES.indexOf(d.trim().slice(-2).toUpperCase()))
    .filter((d) => d >= 0);
  return { freq, interval, count, until, byDay: [...new Set(byDay)].sort((a, b) => a - b) };
}

/** Wall dates of the occurrences of a rule from the start day, in order, without COUNT/UNTIL applied. */
function* occurrenceDays(startKey: string, rule: Rule, lastKey: string): Generator<string> {
  let guard = 0;
  if (rule.freq === 'DAILY') {
    for (let k = startKey; k <= lastKey && guard++ < MAX_ITERATIONS; k = addDays(k, rule.interval)) yield k;
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length > 0 ? rule.byDay : [weekdayOf(startKey)];
    const mondayOffset = (weekdayOf(startKey) + 6) % 7;
    const weekStart = addDays(startKey, -mondayOffset);
    for (let w = 0; guard++ < MAX_ITERATIONS; w += rule.interval) {
      const base = addDays(weekStart, w * 7);
      if (base > lastKey) return;
      for (const wd of days) {
        const k = addDays(base, (wd + 6) % 7);
        if (k >= startKey && k <= lastKey) yield k;
      }
    }
  } else {
    const [y, mo, d] = startKey.split('-').map(Number) as [number, number, number];
    for (let i = 0; guard++ < MAX_ITERATIONS; i += rule.interval) {
      const month = new Date(Date.UTC(y, mo - 1 + i, 1));
      const k = `${String(month.getUTCFullYear()).padStart(4, '0')}-${String(month.getUTCMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (`${k.slice(0, 8)}01` > lastKey) return;
      if (isKey(k) && k <= lastKey) yield k;
    }
  }
}

interface RawEvent {
  summary: string;
  start: Stamp;
  end: Stamp | null;
  location?: string;
  url?: string;
  rule: Rule | null;
  /** Instants (ms) of excluded occurrences; all-day ones as the local midnight. */
  exclude: Set<number>;
}

/** The events of an ICS text, recurrences not yet expanded. */
export function parseIcs(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  let cur: Prop[] | null = null;
  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      if (prop.value.toUpperCase() === 'VEVENT') cur = [];
    } else if (prop.name === 'END') {
      if (prop.value.toUpperCase() === 'VEVENT' && cur) {
        const ev = buildEvent(cur);
        if (ev) events.push(ev);
        cur = null;
      }
    } else if (cur) {
      cur.push(prop);
    }
  }
  return events;
}

function buildEvent(props: Prop[]): RawEvent | null {
  const first = (name: string): Prop | undefined => props.find((p) => p.name === name);
  const dtstart = first('DTSTART');
  const start = dtstart ? parseStamp(dtstart) : null;
  if (!start) return null;
  const dtend = first('DTEND');
  const rrule = first('RRULE');
  const exclude = new Set<number>();
  for (const ex of props.filter((p) => p.name === 'EXDATE')) {
    for (const v of ex.value.split(',')) {
      const s = parseStamp({ ...ex, value: v });
      if (s) exclude.add(instantOf(s.key, s.secs, s.allDay ? undefined : (s.zone ?? start.zone)));
    }
  }
  const location = first('LOCATION')?.value;
  const url = first('URL')?.value.trim();
  return {
    summary: unescapeText(first('SUMMARY')?.value ?? '').trim(),
    start,
    end: dtend ? parseStamp(dtend) : null,
    ...(location ? { location: unescapeText(location).trim() } : {}),
    ...(url ? { url } : {}),
    rule: rrule ? parseRule(rrule.value, rrule.params) : null,
    exclude,
  };
}

/** The events (recurrences expanded) that overlap the local days `fromKey` to `toKey` inclusive, by start. */
export function expandIcs(text: string, fromKey: string, toKey: string): IcsEvent[] {
  if (!isKey(fromKey) || !isKey(toKey) || toKey < fromKey) return [];
  const windowStart = instantOf(fromKey, 0, undefined);
  const windowEnd = instantOf(addDays(toKey, 1), 0, undefined);
  const out: IcsEvent[] = [];

  for (const ev of parseIcs(text)) {
    const { start } = ev;
    const zone = start.allDay ? undefined : start.zone;
    const startMs = instantOf(start.key, start.secs, zone);
    let spanMs: number;
    let spanDays = 1;
    if (start.allDay) {
      spanDays = ev.end?.allDay && ev.end.key > start.key ? daysBetween(start.key, ev.end.key) : 1;
      spanMs = 0;
    } else {
      const endMs = ev.end ? instantOf(ev.end.key, ev.end.secs, ev.end.allDay ? undefined : (ev.end.zone ?? zone)) : startMs;
      spanMs = Math.max(0, endMs - startMs);
    }

    const emit = (key: string): boolean => {
      const occStart = instantOf(key, start.secs, zone);
      if (ev.exclude.has(occStart)) return true;
      if (start.allDay) {
        const endKey = addDays(key, spanDays);
        if (instantOf(endKey, 0, undefined) <= windowStart || instantOf(key, 0, undefined) >= windowEnd) return true;
        out.push({ summary: ev.summary, start: key, end: endKey, allDay: true, ...(ev.location && { location: ev.location }), ...(ev.url && { url: ev.url }) });
      } else {
        const occEnd = occStart + spanMs;
        if (occEnd < windowStart || occStart >= windowEnd || (occEnd === windowStart && spanMs > 0)) return true;
        out.push({
          summary: ev.summary,
          start: new Date(occStart).toISOString(),
          end: new Date(occEnd).toISOString(),
          allDay: false,
          ...(ev.location && { location: ev.location }),
          ...(ev.url && { url: ev.url }),
        });
      }
      return true;
    };

    if (!ev.rule) {
      emit(start.key);
    } else {
      const { rule } = ev;
      const untilMs = rule.until ? (rule.until.allDay ? instantOf(addDays(rule.until.key, 1), 0, undefined) - 1 : instantOf(rule.until.key, rule.until.secs, rule.until.zone ?? zone)) : Infinity;
      let n = 0;
      for (const key of occurrenceDays(start.key, rule, addDays(toKey, 1))) {
        if (n >= rule.count) break;
        if (instantOf(key, start.secs, zone) > untilMs) break;
        n++;
        emit(key);
      }
    }
    if (out.length >= MAX_EVENTS) break;
  }

  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)).slice(0, MAX_EVENTS);
}

/** The local days an event touches, as keys (an all-day event: each day it covers). */
export function eventDays(ev: IcsEvent): string[] {
  if (ev.allDay) {
    const days: string[] = [];
    for (let k = ev.start; k < ev.end && days.length < 366; k = addDays(k, 1)) days.push(k);
    return days;
  }
  const first = dayKey(new Date(ev.start));
  const lastInstant = new Date(Math.max(new Date(ev.start).getTime(), new Date(ev.end).getTime() - 1));
  const last = dayKey(lastInstant);
  const days: string[] = [];
  for (let k = first; k <= last && days.length < 366; k = addDays(k, 1)) days.push(k);
  return days;
}
