import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RestHistoryEntry } from '@deckbuilder/server-core/protocol';
import { withoutAuthorization } from './http.ts';

export type { RestHistoryEntry };

export interface RestHistoryOptions {
  /** Folder of `rest-history.json`. */
  dir: string;
  /** Most entries kept; 0 turns recording off. A function is read on every append. */
  max: number | (() => number);
}

export interface RestHistory {
  /** Adds an entry at the top without Authorization headers (no-op while max is 0); gives the stored entry, or null when off. */
  append(entry: Omit<RestHistoryEntry, 'id'>): Promise<RestHistoryEntry | null>;
  /** Newest first; `q` matches the method and URL ignoring case. */
  list(filter?: { q?: string }): Promise<RestHistoryEntry[]>;
  clear(): Promise<void>;
  setMax(max: number): void;
}

const isEntry = (e: unknown): e is RestHistoryEntry => {
  const r = e as Partial<RestHistoryEntry> | null;
  return (
    typeof r === 'object' && r !== null && typeof r.id === 'string' && typeof r.method === 'string' && typeof r.url === 'string' &&
    typeof r.at === 'number' && typeof r.status === 'number' && typeof r.ms === 'number' && typeof r.draft === 'object' && r.draft !== null &&
    Array.isArray(r.draft.headers)
  );
};

/** The REST request history in `<dir>/rest-history.json`: newest first, capped at `max`, written atomically. */
export function restHistory({ dir, max }: RestHistoryOptions): RestHistory {
  const file = join(dir, 'rest-history.json');
  let limit = max;
  const maxNow = () => Math.max(0, Math.floor(typeof limit === 'function' ? limit() : limit) || 0);
  let entries: Promise<RestHistoryEntry[]> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function load(): Promise<RestHistoryEntry[]> {
    entries ??= readFile(file, 'utf8')
      .then((text) => {
        const raw: unknown = JSON.parse(text);
        return Array.isArray(raw) ? raw.filter(isEntry) : [];
      })
      .catch(() => []);
    return entries;
  }

  function mutate<T>(change: (list: RestHistoryEntry[]) => { list: RestHistoryEntry[]; result: T; dirty: boolean }): Promise<T> {
    const run = queue.then(async () => {
      const { list, result, dirty } = change(await load());
      entries = Promise.resolve(list);
      if (dirty) {
        await mkdir(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
        try {
          await writeFile(tmp, JSON.stringify(list));
          await rename(tmp, file);
        } catch (err) {
          await rm(tmp, { force: true });
          throw err;
        }
      }
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    append(entry) {
      if (maxNow() === 0) return Promise.resolve(null);
      return mutate((list) => {
        const cap = maxNow();
        if (cap === 0) return { list, result: null, dirty: false };
        const stored: RestHistoryEntry = { id: crypto.randomUUID(), ...entry, draft: withoutAuthorization(entry.draft) };
        return { list: [stored, ...list].slice(0, cap), result: stored, dirty: true };
      });
    },
    async list({ q } = {}) {
      await queue;
      const needle = q?.trim().toLowerCase();
      return (await load()).filter((e) => !needle || `${e.method} ${e.url}`.toLowerCase().includes(needle));
    },
    clear: () => mutate((list) => ({ list: [], result: undefined, dirty: list.length > 0 })),
    setMax(n) {
      limit = n;
    },
  };
}
