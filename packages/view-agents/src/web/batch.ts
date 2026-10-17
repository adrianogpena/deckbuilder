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

/** The session fields archiving looks at. */
export interface ArchiveCandidate {
  id: string;
  status: string;
  archived?: boolean;
  live?: boolean;
  external?: boolean;
  lifecycle?: string;
}

/** Live in this app (not in another terminal). */
export function liveHere(s: Pick<ArchiveCandidate, 'live' | 'external' | 'lifecycle'>): boolean {
  return !s.external && (!!s.live || s.lifecycle !== undefined);
}

/** Running or Waiting for the user: archiving is refused while a session is live here in one of these. */
export function isWorking(s: ArchiveCandidate): boolean {
  return liveHere(s) && (s.status === 'running' || s.status === 'needs-you');
}

/** Batch archive split: sessions to flip (`stop` = stop it first) and how many were skipped as still working (id-less included). */
export function partitionArchive<T extends ArchiveCandidate>(list: readonly T[], unarchive: boolean): { ok: Array<{ s: T; stop: boolean }>; working: number } {
  const ok: Array<{ s: T; stop: boolean }> = [];
  let working = 0;
  for (const s of list) {
    if (!s.id || (!unarchive && isWorking(s))) {
      working++;
      continue;
    }
    ok.push({ s, stop: !unarchive && liveHere(s) });
  }
  return { ok, working };
}

/** Which batch archive toast: nothing checked, all done, some skipped, or none done. */
export function archiveOutcome(done: number, working: number): 'empty' | 'all' | 'some' | 'none' {
  if (done === 0) return working ? 'none' : 'empty';
  return working ? 'some' : 'all';
}
