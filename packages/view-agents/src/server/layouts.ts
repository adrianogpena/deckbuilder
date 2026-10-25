import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';
import { projectKey } from './projects.ts';

const MAX_PANES = 8;
const MAX_TABS = 60;
const MAX_KIND = 40;

/** A saved workspace layout: the `tabs.ts` serialized `Layout` of one project, each tab route `{ kind, params }`. */
export interface SavedLayout {
  focused?: string;
  panes: Array<{ id: string; active?: string; tabs: Array<{ id: string; route: { kind: string; params?: Record<string, unknown> } }> }>;
  tree?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when `raw` has the shape of a serialized layout: 1..MAX_PANES panes with string ids, each tab a route with a string `kind`. */
export function isSavedLayout(raw: unknown): raw is SavedLayout {
  if (!isObject(raw) || !Array.isArray(raw.panes) || raw.panes.length === 0 || raw.panes.length > MAX_PANES) return false;
  let tabs = 0;
  for (const p of raw.panes) {
    if (!isObject(p) || typeof p.id !== 'string' || !Array.isArray(p.tabs)) return false;
    tabs += p.tabs.length;
    if (tabs > MAX_TABS) return false;
    for (const t of p.tabs) {
      if (!isObject(t) || typeof t.id !== 'string' || !isObject(t.route)) return false;
      const { kind, params } = t.route;
      if (typeof kind !== 'string' || kind.length === 0 || kind.length > MAX_KIND) return false;
      if (params !== undefined && !isObject(params)) return false;
    }
  }
  return true;
}

export interface LayoutStore {
  /** The file of a project's layout. */
  fileOf(project: string): string;
  /** The saved layout, or undefined when there is none or the file is bad (a bad file is set aside). */
  read(project: string): Promise<SavedLayout | undefined>;
  /** Saves the layout; false when it is not a layout. */
  write(project: string, layout: unknown): Promise<boolean>;
}

/** One layout file per project in `dir`: `<sha1 of the project path>.json`. */
export function createLayoutStore(dir: string): LayoutStore {
  const fileOf = (project: string) => join(dir, `${createHash('sha1').update(projectKey(project)).digest('hex')}.json`);
  const accept = (v: unknown) => isObject(v) && isSavedLayout(v.layout);
  return {
    fileOf,
    async read(project) {
      if (!project) return undefined;
      const raw = (await readJsonFile(fileOf(project), accept).catch(() => undefined)) as { layout: SavedLayout } | undefined;
      return raw?.layout;
    },
    async write(project, layout) {
      if (!project || !isSavedLayout(layout)) return false;
      await writeJsonAtomic(fileOf(project), { version: 1, project, layout });
      return true;
    },
  };
}
