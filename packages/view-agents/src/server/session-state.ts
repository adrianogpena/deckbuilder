import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentSessionState } from '../protocol.ts';

export const SETTLE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionStateStore {
  get(id: string): AgentSessionState | undefined;
  /** Merges a patch: `name` '' or null clears it; `pinned`/`archived` false stay stored (an explicit unarchive blocks auto-settle). Returns the new state. */
  set(id: string, patch: { pinned?: unknown; name?: unknown; archived?: unknown }): AgentSessionState;
  /** Marks archived the stopped sessions idle for 7+ days that were never archived or unarchived by hand; true when any changed. */
  settle(sessions: Array<{ id: string; status: string; updatedAt: number }>, now?: number): boolean;
}

/** Per-session pin / rename / archive state kept in `file` (`{[sessionId]: {pinned?, name?, archived?}}`). */
export function createSessionStateStore(file: string): SessionStateStore {
  let items: Record<string, AgentSessionState> | undefined;
  const load = () => {
    if (items) return items;
    items = {};
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [id, v] of Object.entries(raw)) if (v && typeof v === 'object') items[id] = v as AgentSessionState;
      }
    } catch {
      /* no state yet */
    }
    return items;
  };
  const save = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(items ?? {}));
    } catch {
      /* best effort */
    }
  };
  return {
    get: (id) => load()[id],
    set(id, patch) {
      const cur = { ...load()[id] };
      if (typeof patch.pinned === 'boolean') cur.pinned = patch.pinned;
      if (typeof patch.archived === 'boolean') cur.archived = patch.archived;
      if (patch.name === null || typeof patch.name === 'string') {
        const n = typeof patch.name === 'string' ? patch.name.trim().slice(0, 200) : '';
        if (n) cur.name = n;
        else delete cur.name;
      }
      load()[id] = cur;
      save();
      return cur;
    },
    settle(sessions, now = Date.now()) {
      let changed = false;
      for (const s of sessions) {
        if (s.status !== 'stopped' || now - s.updatedAt < SETTLE_AFTER_MS) continue;
        const cur = load()[s.id];
        if (cur?.archived !== undefined) continue;
        load()[s.id] = { ...cur, archived: true };
        changed = true;
      }
      if (changed) save();
      return changed;
    },
  };
}
