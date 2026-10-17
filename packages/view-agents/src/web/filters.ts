import { type AgentCategory, STATUS_CATEGORY } from '../protocol.ts';
import type { AgentSessionView } from './api';

/** Time filter on the session's modification time; `*` cycles them in this order. */
export type TimeMode = 'all' | 'today' | '3d' | '7d';
export const TIME_MODES: readonly TimeMode[] = ['all', 'today', '3d', '7d'];

/** Sidebar filters: status categories (OR, empty = none), time and one exact tag. AND across kinds. */
export interface AgentFilters {
  status: ReadonlySet<AgentCategory>;
  time: TimeMode;
  tag?: string;
}

export const NO_FILTERS: AgentFilters = { status: new Set(), time: 'all' };

/** Category order of the pills, with the key that toggles each. */
export const CATEGORIES: readonly AgentCategory[] = ['running', 'waiting', 'idle', 'error', 'stopped'];
export const STATUS_KEYS: Readonly<Record<string, AgentCategory>> = { '!': 'running', '@': 'waiting', '#': 'idle', '&': 'error', '~': 'stopped' };

export const categoryOf = (s: AgentSessionView): AgentCategory => STATUS_CATEGORY[s.status] ?? 'stopped';

export const isFiltering = (f: AgentFilters): boolean => f.status.size > 0 || f.time !== 'all' || f.tag !== undefined;

export function toggleStatus(f: AgentFilters, c: AgentCategory): AgentFilters {
  const status = new Set(f.status);
  if (!status.delete(c)) status.add(c);
  return { ...f, status };
}

export const clearStatus = (f: AgentFilters): AgentFilters => ({ ...f, status: new Set() });

export const nextTime = (f: AgentFilters): AgentFilters => ({ ...f, time: TIME_MODES[(TIME_MODES.indexOf(f.time) + 1) % TIME_MODES.length]! });

/** The same tag clears it, another one switches. */
export const toggleTag = (f: AgentFilters, tag: string): AgentFilters => ({ ...f, tag: f.tag === tag ? undefined : tag });

/** Clear (`0`): status, time and tag together; the archived view is not a filter here. */
export const clearFilters = (): AgentFilters => ({ status: new Set(), time: 'all' });

const HOUR = 3_600_000;

/** Earliest modification time the mode keeps (ms), undefined for all time. Today = local midnight, else now − 24 h. */
export function timeCutoff(mode: TimeMode, now: number): number | undefined {
  if (mode === '3d') return now - 72 * HOUR;
  if (mode === '7d') return now - 168 * HOUR;
  if (mode !== 'today') return undefined;
  const d = new Date(now);
  const day = d.getDate();
  d.setHours(0, 0, 0, 0);
  return d.getHours() === 0 && d.getDate() === day ? d.getTime() : now - 24 * HOUR;
}

/** Status AND time AND tag; `now` is the clock the time filter reads. */
export function matchesFilters(s: AgentSessionView, f: AgentFilters, now: number): boolean {
  if (f.status.size && !f.status.has(categoryOf(s))) return false;
  const cut = timeCutoff(f.time, now);
  if (cut !== undefined && s.updatedAt < cut) return false;
  return f.tag === undefined || !!s.tags?.includes(f.tag);
}

/** The search box text split into mode, optional status category and needle. */
export interface ParsedQuery {
  full: boolean;
  status?: AgentCategory;
  needle: string;
}

/** Leading `?` (full text) and one status key `! @ # & ~` may come in either order (`?@foo`, `@?foo`); the trimmed rest is the needle. */
export function parseQuery(raw: string): ParsedQuery {
  let rest = raw.trimStart();
  let full = false;
  let status: AgentCategory | undefined;
  for (let i = 0; i < 2; i++) {
    const c = rest[0] ?? '';
    if (c === '?' && !full) full = true;
    else if (status === undefined && STATUS_KEYS[c]) status = STATUS_KEYS[c];
    else break;
    rest = rest.slice(1);
  }
  return { full, status, needle: rest.trim() };
}

/** Active panel modes; `selected`, `archived` and `actionable` are the slots later steps fill. */
export interface TitleModes {
  selected?: number;
  archived?: boolean;
  filtered?: boolean;
  actionable?: boolean;
  activeOnTop?: boolean;
}

/** Labels of the title note parts (i18n stays with the caller, so this module loads without the UI kit). */
export interface TitleLabels {
  selected(count: number): string;
  archived: string;
  filtered: string;
  actionable: string;
  activeOnTop: string;
}

/** '· ' + the active modes joined by ' · ', in spec order; '' when none. */
export function titleNote(m: TitleModes, l: TitleLabels): string {
  const parts: string[] = [];
  if (m.selected) parts.push(l.selected(m.selected));
  if (m.archived) parts.push(l.archived);
  if (m.filtered) parts.push(l.filtered);
  if (m.actionable) parts.push(l.actionable);
  if (m.activeOnTop) parts.push(l.activeOnTop);
  return parts.length ? `· ${parts.join(' · ')}` : '';
}
