import { type DialogFilter, pickFile, pickFolder, saveFileAs } from '@deckbuilder/platform';
import type { Routes } from '@deckbuilder/server-core';
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

/**
 * `POST /api/dialog/folder|file|save` with the dialog options → `{ path: string | null }` (null =
 * cancelled). The path is absolute: use it to register a root or as a one-shot save target only.
 */
export function dialogRoutes(): Routes {
  const result = (path: Promise<string | null>) => path.then((p) => ({ path: p }), fromPlatform);
  return {
    'POST /api/dialog/folder': async ({ json }) => {
      const b = await body(json);
      return result(pickFolder({ title: str(b.title), start: str(b.start) }));
    },
    'POST /api/dialog/file': async ({ json }) => {
      const b = await body(json);
      return result(pickFile({ title: str(b.title), start: str(b.start), filters: filters(b.filters) }));
    },
    'POST /api/dialog/save': async ({ json }) => {
      const b = await body(json);
      return result(saveFileAs({ title: str(b.title), suggestedName: str(b.suggestedName), filters: filters(b.filters) }));
    },
  };
}
