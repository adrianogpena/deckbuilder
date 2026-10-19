import type { PanelKind } from './types';

/** Scope of the single right sidebar shared by every project. */
export const SHARED_SCOPE = '';

export interface RightSide {
  list: PanelKind[];
  open?: boolean;
}

/** Reads one scope out of the map the server stores, dropping kinds `known` rejects and duplicates. */
export function parseRightSide(raw: unknown, scope: string, known: (k: string) => boolean): RightSide {
  const map = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const e = map[scope];
  if (!e || typeof e !== 'object') return { list: [] };
  const r = e as Record<string, unknown>;
  const list = Array.isArray(r.list) ? [...new Set(r.list.filter((k): k is string => typeof k === 'string' && known(k)))] : [];
  return { list: list as PanelKind[], ...(typeof r.open === 'boolean' ? { open: r.open } : {}) };
}
