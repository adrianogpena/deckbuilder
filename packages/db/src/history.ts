import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqlHistoryEntry } from '@kedalion/server-core/protocol';

export type { SqlHistoryEntry };

export interface SqlHistoryOptions {
  /** Folder of `sql-history.json`. */
  dir: string;
  /** Most entries kept; 0 turns recording off. A function is read on every append. */
  max: number | (() => number);
}

export interface SqlHistory {
  /** Adds an entry at the top (no-op while max is 0); gives the stored entry, or null when off. */
  append(entry: Omit<SqlHistoryEntry, 'id'>): Promise<SqlHistoryEntry | null>;
  /** Sets the row count of an entry, if it still exists. */
  setRows(id: string, rows: number): Promise<void>;
  /** Newest first; `q` matches the SQL ignoring case, `connection` the connection id. */
  list(filter?: { q?: string; connection?: string }): Promise<SqlHistoryEntry[]>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  setMax(max: number): void;
}

const isEntry = (e: unknown): e is SqlHistoryEntry => {
  const r = e as Partial<SqlHistoryEntry> | null;
  return (
    typeof r === 'object' && r !== null && typeof r.id === 'string' && typeof r.connectionId === 'string' &&
    typeof r.sql === 'string' && typeof r.at === 'number' && typeof r.ms === 'number'
  );
};

/** The SQL history in `<dir>/sql-history.json`: newest first, capped at `max`, written atomically. */
export function sqlHistory({ dir, max }: SqlHistoryOptions): SqlHistory {
  const file = join(dir, 'sql-history.json');
  let limit = max;
  const maxNow = () => Math.max(0, Math.floor(typeof limit === 'function' ? limit() : limit) || 0);
  let entries: Promise<SqlHistoryEntry[]> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function load(): Promise<SqlHistoryEntry[]> {
    entries ??= readFile(file, 'utf8')
      .then((text) => {
        const raw: unknown = JSON.parse(text);
        return Array.isArray(raw) ? raw.filter(isEntry) : [];
      })
      .catch(() => []);
    return entries;
  }

  /** Runs `change` on the list, one at a time, then writes it via a temp file and a rename. */
  function mutate<T>(change: (list: SqlHistoryEntry[]) => { list: SqlHistoryEntry[]; result: T; dirty: boolean }): Promise<T> {
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
        const stored: SqlHistoryEntry = { id: crypto.randomUUID(), ...entry };
        return { list: [stored, ...list].slice(0, cap), result: stored, dirty: true };
      });
    },
    setRows: (id, rows) =>
      mutate((list) => {
        const i = list.findIndex((e) => e.id === id);
        if (i < 0) return { list, result: undefined, dirty: false };
        const next = list.slice();
        next[i] = { ...next[i]!, rows };
        return { list: next, result: undefined, dirty: true };
      }),
    async list({ q, connection } = {}) {
      await queue;
      const needle = q?.toLowerCase();
      return (await load()).filter((e) => (!connection || e.connectionId === connection) && (!needle || e.sql.toLowerCase().includes(needle)));
    },
    delete(ids) {
      const drop = new Set(ids);
      return mutate((list) => {
        const next = list.filter((e) => !drop.has(e.id));
        return { list: next, result: undefined, dirty: next.length !== list.length };
      });
    },
    clear: () => mutate((list) => ({ list: [], result: undefined, dirty: list.length > 0 })),
    setMax(n) {
      limit = n;
    },
  };
}
