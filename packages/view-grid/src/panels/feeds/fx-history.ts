import { summarize, type FxData } from './fx';

/** One fetch: what the panel showed right after it. */
export interface FxUpdate {
  /** ISO time of the fetch. */
  at: string;
  value: number;
  /** Change vs. the first day of the period. */
  change: number;
  percent: number;
  live?: boolean;
}

export interface FxHistory {
  /** Every fetch, oldest first. */
  updates: FxUpdate[];
  /** The series the panel's graph shows from the last fetch, oldest first. */
  dates: string[];
  values: number[];
}

const KEY = 'kedalion.fx-history';
const EVENT = 'fx-history';
const MAX_UPDATES = 10_000;

const pairKey = (base: string, quote: string) => `${base}/${quote}`;

function readAll(): Record<string, any> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** The saved history of a pair; empty before the first fetch. */
export function readFxHistory(base: string, quote: string): FxHistory {
  const hit = readAll()[pairKey(base, quote)];
  return {
    updates: Array.isArray(hit?.updates) ? hit.updates : [],
    dates: Array.isArray(hit?.dates) ? hit.dates : [],
    values: Array.isArray(hit?.values) ? hit.values : [],
  };
}

/** Adds one fetch to the history and keeps the updates of the last `days` days. */
export function addFxUpdate(prev: FxHistory, data: FxData, days: number, now: Date): FxHistory {
  const summary = summarize(data.values);
  if (!summary) return prev;
  const cutoff = now.getTime() - days * 86_400_000;
  const updates = [...prev.updates, { at: now.toISOString(), value: summary.value, change: summary.change, percent: summary.percent, live: data.live }]
    .filter((u) => Date.parse(u.at) >= cutoff)
    .slice(-MAX_UPDATES);
  return { updates, dates: data.dates, values: data.values };
}

/** Saves a fetch into the pair's history and tells open side panels. */
export function recordFx(data: FxData, days: number): void {
  if (data.values.length === 0) return;
  try {
    const all = readAll();
    const key = pairKey(data.base, data.quote);
    all[key] = addFxUpdate(readFxHistory(data.base, data.quote), data, days, new Date());
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: the side panel stays as it was
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pairKey(data.base, data.quote) }));
}

/** Calls `run` when the history of `base/quote` changes; returns the unsubscribe. */
export function onFxHistory(base: string, quote: string, run: () => void): () => void {
  const handler = (e: Event) => {
    if ((e as CustomEvent<string>).detail === pairKey(base, quote)) run();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
