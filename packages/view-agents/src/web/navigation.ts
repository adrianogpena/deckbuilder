import { categoryOf } from './filters';
import type { AgentSessionView } from './api';
import { type TreeRow } from './tree';

/** The logical identity of a row across rebuilds: session = id, project = node id, folder = folder id. Dividers have none. */
export function rowKey(r: TreeRow): string | undefined {
  if (r.kind === 'session') return `s:${r.session.id}`;
  if (r.kind === 'project') return `p:${r.key}`;
  if (r.kind === 'folder') return `f:${r.id}`;
  return undefined;
}

export const sessionKey = (id: string) => `s:${id}`;
export const tagKey = (tag: string) => `t:${tag}`;

/**
 * The row to select after a rebuild. The selected key itself if it survives; else the first surviving row that came
 * after it in the old list; else the nearest surviving row before it; else the first session row; else row 0.
 */
export function reselect(oldKeys: ReadonlyArray<string | undefined>, selected: string, next: ReadonlyArray<string | undefined>): string | undefined {
  const here = new Set(next.filter((k): k is string => k !== undefined));
  if (here.has(selected)) return selected;
  const at = oldKeys.indexOf(selected);
  if (at >= 0) {
    for (let i = at + 1; i < oldKeys.length; i++) {
      const k = oldKeys[i];
      if (k !== undefined && here.has(k)) return k;
    }
    for (let i = at - 1; i >= 0; i--) {
      const k = oldKeys[i];
      if (k !== undefined && here.has(k)) return k;
    }
  }
  return next.find((k) => k?.startsWith('s:')) ?? next.find((k) => k !== undefined);
}

/** The checked batch pruned to sessions that still exist (not merely visible ones); the same set when nothing is dropped. */
export function pruneBatch(checked: ReadonlySet<string>, existing: Iterable<string>): ReadonlySet<string> {
  const have = new Set(existing);
  const kept = [...checked].filter((id) => have.has(id));
  return kept.length === checked.size ? checked : new Set(kept);
}

export interface PreviousState {
  current?: string;
  previous?: string;
}

/** After every handled event: a changed selected session makes the remembered one the previous. Non-session selection (undefined) is ignored. */
export function trackPrevious(state: PreviousState, selected: string | undefined): PreviousState {
  if (!selected || selected === state.current) return state;
  return { current: selected, previous: state.current };
}

/** The ids of session rows `[` / `]` can land on: active: Running (incl. Starting), Waiting (incl. finished-unseen), Idle or Error (not Stopped), in row order. */
export function startedCandidates(rows: TreeRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.kind !== 'session') continue;
    const c = categoryOf(r.session as AgentSessionView);
    if (c !== 'stopped') out.push(r.session.id);
  }
  return out;
}

/** Next candidate below (above for dir -1), wrapping; a current row that is no candidate gives the first (last for -1). Undefined when none. */
export function stepStarted(candidates: string[], current: string | undefined, dir: 1 | -1): string | undefined {
  if (!candidates.length) return undefined;
  const at = current === undefined ? -1 : candidates.indexOf(current);
  if (at < 0) return dir === 1 ? candidates[0] : candidates[candidates.length - 1];
  return candidates[(at + dir + candidates.length) % candidates.length];
}

/** The ids each expanded project shows, for a `freeze` patch (only projects with a session). */
export function shownOrders(rows: TreeRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) if (r.kind === 'session') if (r.session.id) (out[r.projectKey] ??= []).push(r.session.id);
  return out;
}

/** A focusable region of the Agents view: the sidebar tree, the session pane or the side panel. */
export type FocusRegion = 'tree' | 'main' | 'panel';

/** Where focus was last inside the Agents view (kept across view switches). Unset on the first run. */
export const focusMemory: { region?: FocusRegion } = {};

/** The region an element sits in, from the closest region root; undefined outside them. */
export function regionOf(el: Element | null): FocusRegion | undefined {
  const root = el?.closest('.agents-sidebar, .agents-main, .agents-panel');
  if (!root) return undefined;
  return root.classList.contains('agents-sidebar') ? 'tree' : root.classList.contains('agents-main') ? 'main' : 'panel';
}

export interface PaneWidths {
  sidebar: number;
  panel: number;
  /** Width of the wide (Trajectory) panel; the CSS default until dragged. */
  panelWide?: number;
}

export const WIDTHS_KEY = 'deckbuilder.agents.widths';
export const SIDEBAR_W = { min: 220, max: 520, def: 260 };
export const PANEL_W = { min: 240, max: 900, def: 320 };

const clamp = (v: number, r: { min: number; max: number }) => Math.round(Math.min(r.max, Math.max(r.min, v)));

/** Stored widths, clamped; defaults for anything missing or malformed. */
export function parseWidths(raw: string | null): PaneWidths {
  let v: Partial<PaneWidths> = {};
  try {
    v = raw ? (JSON.parse(raw) as Partial<PaneWidths>) : {};
  } catch {
    /* malformed: defaults */
  }
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const wide = num(v?.panelWide);
  return {
    sidebar: clamp(num(v?.sidebar) ?? SIDEBAR_W.def, SIDEBAR_W),
    panel: clamp(num(v?.panel) ?? PANEL_W.def, PANEL_W),
    ...(wide === undefined ? {} : { panelWide: clamp(wide, PANEL_W) }),
  };
}

export const clampWidth = (which: 'sidebar' | 'panel', v: number) => clamp(v, which === 'sidebar' ? SIDEBAR_W : PANEL_W);
