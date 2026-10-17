/** Pure helpers of the checked batch (no UI kit, no i18n). */

/** The batch with `id` added or removed. */
export function toggleChecked(checked: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(checked);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The checked items in list order, each id once; `ordered` may repeat ids (later copies are ignored). */
export function batchOrder<T extends { id: string }>(ordered: Iterable<T>, checked: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of ordered) {
    if (!checked.has(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

/** Distinct defined keys in first-seen order. */
export function distinctKeys(keys: Iterable<string | undefined>): string[] {
  return [...new Set([...keys].filter((k): k is string => k !== undefined))];
}

/** Batch stop outcome: how many were stopped and how many were not live here. */
export interface StopTally {
  stopped: number;
  notRunning: number;
}

/** Which toast a batch stop shows: none stopped, all stopped, or some not running. */
export function stopOutcome(t: StopTally): 'none' | 'all' | 'some' {
  if (t.stopped === 0) return 'none';
  return t.notRunning ? 'some' : 'all';
}
