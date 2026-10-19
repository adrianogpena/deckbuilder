import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFolderName } from './discovery.ts';
import { costOf } from './pricing.ts';
import { localDayKey } from './usage-history.ts';

export interface UsageTokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** One priced assistant message. */
export interface UsageRecord {
  /** ms epoch of the entry timestamp. */
  at: number;
  session: string;
  project: string;
  model: string;
  tokens: UsageTokens;
  usd: number;
}

export interface UsageTotals extends UsageTokens {
  usd: number;
}

export interface UsageRow extends UsageTotals {
  key: string;
}

export interface UsageSummary {
  now: number;
  today: UsageTotals;
  week: UsageTotals;
  month: UsageTotals;
  /** The last 30 local days, oldest first. */
  days: Array<{ day: string; usd: number }>;
  /** USD per hour over the last 5 hours (the rate-limit window). */
  burnPerHour: number;
  bySession: UsageRow[];
  byProject: UsageRow[];
  byModel: UsageRow[];
}

const DAY = 86_400_000;
const WINDOW_MS = 5 * 3_600_000;
const TOP = 20;

const empty = (): UsageTotals => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 });

function add(into: UsageTotals, r: UsageRecord): void {
  into.input += r.tokens.input;
  into.output += r.tokens.output;
  into.cacheWrite += r.tokens.cacheWrite;
  into.cacheRead += r.tokens.cacheRead;
  into.usd += r.usd;
}

function rows(records: UsageRecord[], keyOf: (r: UsageRecord) => string): UsageRow[] {
  const by = new Map<string, UsageRow>();
  for (const r of records) {
    const key = keyOf(r);
    let row = by.get(key);
    if (!row) by.set(key, (row = { key, ...empty() }));
    add(row, r);
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd).slice(0, TOP);
}

/** Totals for today / 7 days / 30 days, the 30-day series, the burn rate and the tables, over the records. */
export function summarize(records: UsageRecord[], now: number): UsageSummary {
  const d = new Date(now);
  const startOf = (back: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
  const todayAt = startOf(0);
  const weekAt = startOf(6);
  const monthAt = startOf(29);
  const today = empty();
  const week = empty();
  const month = empty();
  const perDay = new Map<string, number>();
  const inMonth: UsageRecord[] = [];
  let windowUsd = 0;
  for (const r of records) {
    if (r.at >= monthAt && r.at <= now + DAY) {
      add(month, r);
      inMonth.push(r);
      const k = localDayKey(r.at);
      perDay.set(k, (perDay.get(k) ?? 0) + r.usd);
      if (r.at >= weekAt) add(week, r);
      if (r.at >= todayAt) add(today, r);
    }
    if (r.at >= now - WINDOW_MS && r.at <= now) windowUsd += r.usd;
  }
  const days: UsageSummary['days'] = [];
  for (let i = 29; i >= 0; i--) {
    const day = localDayKey(startOf(i) + 12 * 3_600_000);
    days.push({ day, usd: perDay.get(day) ?? 0 });
  }
  return {
    now,
    today,
    week,
    month,
    days,
    burnPerHour: windowUsd / 5,
    bySession: rows(inMonth, (r) => r.session),
    byProject: rows(inMonth, (r) => r.project),
    byModel: rows(inMonth, (r) => r.model),
  };
}

/** Spend of the local day and month of `now`, overall and per project key (`keyOf` maps a record's project). */
export function spendOf(records: UsageRecord[], now: number, keyOf: (project: string) => string): { day: number; month: number; projects: Record<string, { day: number; month: number }> } {
  const d = new Date(now);
  const dayAt = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const monthAt = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const out = { day: 0, month: 0, projects: {} as Record<string, { day: number; month: number }> };
  for (const r of records) {
    if (r.at < monthAt || r.at > now + DAY) continue;
    const p = (out.projects[keyOf(r.project)] ??= { day: 0, month: 0 });
    out.month += r.usd;
    p.month += r.usd;
    if (r.at >= dayAt) {
      out.day += r.usd;
      p.day += r.usd;
    }
  }
  return out;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Priced records of one transcript's text: a repeated message id keeps its last usage; unknown models and entries without a timestamp are left out. */
export function recordsOf(text: string, session: string, fallbackProject: string): UsageRecord[] {
  const byId = new Map<string, UsageRecord>();
  let project = '';
  let n = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!project && typeof e?.cwd === 'string' && e.cwd) project = e.cwd;
    if (e?.type !== 'assistant') continue;
    const u = e.message?.usage;
    const model = e.message?.model;
    const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
    if (!u || typeof u !== 'object' || typeof model !== 'string' || !Number.isFinite(at)) continue;
    const tokens = { input: num(u.input_tokens), output: num(u.output_tokens), cacheWrite: num(u.cache_creation_input_tokens), cacheRead: num(u.cache_read_input_tokens) };
    const usd = costOf(model, { input: tokens.input, output: tokens.output, cacheCreation: tokens.cacheWrite, cacheRead: tokens.cacheRead, cacheCreation1h: num(u.cache_creation?.ephemeral_1h_input_tokens) });
    if (usd === undefined) continue;
    const id = typeof e.message?.id === 'string' && e.message.id ? e.message.id : `#${n++}`;
    byId.set(id, { at, session, project: '', model, tokens, usd });
  }
  const p = project || fallbackProject;
  return [...byId.values()].map((r) => ({ ...r, project: p }));
}

/** Reads every account's transcripts modified in the last 31 days, re-parsing only changed files. */
export function createBreakdownReader() {
  const cache = new Map<string, { mtime: number; size: number; records: UsageRecord[] }>();
  return {
    read(accounts: Array<{ dir: string }>, now: number): UsageRecord[] {
      const since = now - 31 * DAY;
      const seen = new Set<string>();
      const out: UsageRecord[] = [];
      for (const acc of accounts) {
        const root = join(acc.dir, 'projects');
        let folders: string[] = [];
        try {
          folders = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
          continue;
        }
        for (const folder of folders) {
          let files: string[] = [];
          try {
            files = readdirSync(join(root, folder)).filter((f) => f.endsWith('.jsonl'));
          } catch {
            continue;
          }
          for (const f of files) {
            const file = join(root, folder, f);
            try {
              const st = statSync(file);
              if (st.mtimeMs < since) continue;
              seen.add(file);
              let c = cache.get(file);
              if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
                c = { mtime: st.mtimeMs, size: st.size, records: recordsOf(readFileSync(file, 'utf8'), f.slice(0, -6), decodeFolderName(folder)) };
                cache.set(file, c);
              }
              for (const r of c.records) out.push(r);
            } catch {
              /* vanished or unreadable */
            }
          }
        }
      }
      for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
      return out;
    },
  };
}
