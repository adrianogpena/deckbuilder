import { useEffect, useSyncExternalStore } from 'react';
import type { AccountPrefsMap } from '../protocol.ts';
import { getAccountPrefs, putAccountPrefs } from './api';

let current: AccountPrefsMap = {};
let loaded = false;
const listeners = new Set<() => void>();

/** Replaces the shared prefs (socket frame `accountPrefs`, or a PUT reply) and tells every `useAccountPrefs` user. */
export function applyAccountPrefs(next: AccountPrefsMap): void {
  current = next;
  loaded = true;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

let saving: Promise<unknown> = Promise.resolve();

/**
 * Saves the whole prefs map built by `update` from the latest shared prefs; saves run one at a time, each after the
 * previous reply, so a quick second change never erases the first. False when the server refused it (nothing changed).
 */
export function saveAccountPrefs(update: (old: AccountPrefsMap) => AccountPrefsMap): Promise<boolean> {
  const run = saving.then(async () => {
    const r = await putAccountPrefs(update(current));
    if (r.ok) applyAccountPrefs(r.prefs);
    return r.ok;
  });
  saving = run.catch(() => undefined);
  return run;
}

/** Per-account prefs (usage overrides, status icons), shared by all callers: fetched once, then kept current by the socket frame. Empty until loaded. */
export function useAccountPrefs(): { prefs: AccountPrefsMap; save(update: (old: AccountPrefsMap) => AccountPrefsMap): Promise<boolean> } {
  const prefs = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!loaded) void getAccountPrefs().then((p) => { if (!loaded) applyAccountPrefs(p); }, () => {});
  }, []);
  return { prefs, save: saveAccountPrefs };
}
