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

/** Where focus was last inside the Agents view (kept across view switches): the tree or the session pane. Unset on the first run. */
export const focusMemory: { region?: 'tree' | 'main' } = {};
