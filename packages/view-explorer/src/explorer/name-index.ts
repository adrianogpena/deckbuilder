import { useCallback, useEffect, useRef, useState } from 'react';
import { stream } from '@deckbuilder/ui';
import type { Project, SearchHit } from '../client';

export interface NameIndex {
  /** Every file and folder path of each project, as `/api/fs/names` lists them. */
  entries: Record<string, SearchHit[]>;
  loading: boolean;
  /** Loads the projects whose index is missing or older than `maxAgeMs`. */
  ensure(ids: string[], maxAgeMs?: number): void;
}

/** Per-project name lists for Quick Open and tree find, cached until `ensure` finds them stale or `exclude` changes. */
export function useNameIndex(projects: Project[], exclude: string[]): NameIndex {
  const [entries, setEntries] = useState<Record<string, SearchHit[]>>({});
  const [pending, setPending] = useState(0);
  const loaded = useRef(new Map<string, number>());
  const running = useRef(new Map<string, AbortController>());
  const excludeKey = JSON.stringify(exclude);
  const known = useRef(projects);
  known.current = projects;

  const load = useCallback((id: string) => {
    running.current.get(id)?.abort();
    const ac = new AbortController();
    running.current.set(id, ac);
    const found: SearchHit[] = [];
    setPending((n) => n + 1);
    stream('/api/fs/names', { root: id, path: '', exclude: JSON.parse(excludeKey).length ? excludeKey : undefined }, (hit) => found.push(hit as SearchHit), ac.signal)
      .then(() => {
        loaded.current.set(id, Date.now());
        setEntries((e) => ({ ...e, [id]: found }));
      })
      .catch(() => { /* an aborted or failed listing leaves the old one */ })
      .finally(() => {
        if (running.current.get(id) === ac) running.current.delete(id);
        setPending((n) => n - 1);
      });
  }, [excludeKey]);

  useEffect(() => {
    loaded.current.clear();
    return () => {
      for (const ac of running.current.values()) ac.abort();
    };
  }, [excludeKey]);

  const ensure = useCallback((ids: string[], maxAgeMs = 10_000) => {
    const now = Date.now();
    for (const id of ids) {
      if (running.current.has(id) || !known.current.some((p) => p.id === id)) continue;
      const at = loaded.current.get(id);
      if (at === undefined || now - at > maxAgeMs) load(id);
    }
  }, [load]);

  return { entries, loading: pending > 0, ensure };
}
