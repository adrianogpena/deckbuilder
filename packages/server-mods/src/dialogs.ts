import { type DialogFilter, pickFile, pickFolder, saveFileAs } from '@deckbuilderkit/platform';
import type { Routes } from '@deckbuilderkit/server-core';
import { fromPlatform } from './platform-errors.ts';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The well-typed filters of a body; malformed ones are dropped. */
function filters(v: unknown): DialogFilter[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((f): f is { name: unknown; patterns: unknown[] } => typeof f === 'object' && f !== null && Array.isArray(f.patterns))
    .map((f) => ({ name: str(f.name) ?? '', patterns: f.patterns.filter((p): p is string => typeof p === 'string') }));
}

const body = async (json: () => Promise<unknown>) => (await json()) as Record<string, unknown>;

/** Paths a server dialog returned that a later route may accept once. */
export interface PickedPaths {
  add(path: string): void;
  /** True once for a path added less than `ttlMs` ago (exact match); removes it. */
  take(path: string): boolean;
}

/** A one-shot set of dialog results; adding beyond `max` drops the oldest entry. */
export function pickedPaths(opts: { max?: number; ttlMs?: number; now?: () => number } = {}): PickedPaths {
  const { max = 20, ttlMs = 600_000, now = Date.now } = opts;
  const added = new Map<string, number>();
  return {
    add(path) {
      added.delete(path);
      added.set(path, now());
      while (added.size > max) added.delete(added.keys().next().value as string);
    },
    take(path) {
      const at = added.get(path);
      if (at === undefined) return false;
      added.delete(path);
      return now() - at < ttlMs;
    },
  };
}

/**
 * `POST /api/dialog/folder|file|save` with the dialog options → `{ path: string | null }` (null =
 * cancelled). The path is absolute: a route that takes it back from the client must check it with
 * `picked.take` (folder and file results are added to `picked`; save targets need their own route).
 */
export function dialogRoutes(opts: { picked?: PickedPaths } = {}): Routes {
  const result = (path: Promise<string | null>, pick = true) =>
    path.then((p) => {
      if (pick && p !== null) opts.picked?.add(p);
      return { path: p };
    }, fromPlatform);
  return {
    'POST /api/dialog/folder': async ({ json }) => {
      const b = await body(json);
      return result(pickFolder({ title: str(b.title) }));
    },
    'POST /api/dialog/file': async ({ json }) => {
      const b = await body(json);
      return result(pickFile({ title: str(b.title), filters: filters(b.filters) }));
    },
    'POST /api/dialog/save': async ({ json }) => {
      const b = await body(json);
      return result(saveFileAs({ title: str(b.title), suggestedName: str(b.suggestedName), filters: filters(b.filters), start: str(b.start) }), false);
    },
  };
}
