import { fuzzyScore } from '@deckbuilder/ui/fuzzy';
import { relPath } from '@deckbuilder/ui/rel-path';
import type { SearchHit } from '../../api';

export interface FindResult {
  /** Matched entries by path: indices into the entry's name to highlight. */
  matches: Map<string, number[]>;
  /** Folder path -> matched entries below it ('' is the project root). */
  counts: Map<string, number>;
  /** Matched entries in tree order. */
  order: string[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Entries whose name matches `query` (their path when the query has a `/`), with the folder counts above them. */
export function findInTree(query: string, entries: readonly SearchHit[]): FindResult | undefined {
  const q = query.trim().replace(/\\/g, '/').replace(/\s+/g, '');
  if (!q) return undefined;
  const byPath = q.includes('/');
  const matches = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const e of entries) {
    const name = relPath.basename(e.path);
    const m = fuzzyScore(q, byPath ? e.path : name);
    if (!m) continue;
    const offset = e.path.length - name.length;
    matches.set(e.path, m.positions.filter((p) => !byPath || p >= offset).map((p) => (byPath ? p - offset : p)));
    for (let dir = relPath.dirname(e.path); ; dir = relPath.dirname(dir)) {
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
      if (!dir) break;
    }
  }
  const order = [...matches.keys()].sort((a, b) => collator.compare(a, b));
  return { matches, counts, order };
}
