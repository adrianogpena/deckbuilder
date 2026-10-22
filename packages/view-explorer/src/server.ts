import { statSync } from 'node:fs';
import { openWithDefault, revealInFolder } from '@deckbuilderkit/platform';
import { defineServerView, invalid, isRecord, type ServerViewDef } from '@deckbuilderkit/server-core';
import { dbSharedRoutes, type DbStores } from '@deckbuilderkit/db';
import { type DialogPicks, editorRoutes, fromPlatform, httpSharedRoutes, pickedPaths, recordRoutes, rootedFs, type AppStores, type RootedFs } from '@deckbuilderkit/server-mods';
import type { ExplorerSettings } from './explorer-state';
import { type MarkdownStored, validMarkdown } from './settings/markdown';

/** The part of the server settings the Explorer view owns; the app's `Settings` extends it. */
export interface ExplorerServerSettings {
  /** Explorer screen state; checked by `validExplorer`. */
  explorer?: ExplorerSettings;
  /** Markdown editor settings; checked by `validMarkdown`. */
  markdown?: Partial<MarkdownStored>;
}

const MAX_TABS_LAYOUT_BYTES = 64 * 1024;
const MAX_EXPANDED_IDS = 2000;
const MAX_ID_LENGTH = 64;
const ID = /^[\w-]{1,64}$/;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

const validPair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && Math.abs(v[0] + v[1] - 1) <= 0.01
    ? [v[0], v[1]]
    : null;

/** A project-id to connection-id map, or null when malformed. */
function validConnections(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, string> = {};
  for (const [project, id] of Object.entries(raw)) {
    if (!ID.test(project) || typeof id !== 'string' || !ID.test(id)) return null;
    out[project] = id;
  }
  return out;
}

/** A copy of `raw` when it is a well-formed explorer state within the size limits, else null. */
export function validExplorer(raw: unknown): ExplorerSettings | null {
  const r = raw as Partial<ExplorerSettings> | null;
  if (typeof r !== 'object' || r === null) return null;
  const { sizes, collapsed, expanded, tabs, trees, treeSizes, wrapLines, sqlSizes, connections } = r;
  if (!Array.isArray(sizes) || sizes.length !== 2 || !sizes.every((n) => typeof n === 'number' && n >= 0 && n <= 1)) return null;
  if (Math.abs(sizes[0] + sizes[1] - 1) > 0.01) return null;
  if (typeof collapsed !== 'boolean' || typeof expanded !== 'object' || expanded === null || Array.isArray(expanded)) return null;
  const out: Record<string, string[]> = {};
  for (const [project, ids] of Object.entries(expanded)) {
    if (project.length > MAX_ID_LENGTH || !isStringArray(ids) || ids.length > MAX_EXPANDED_IDS) return null;
    out[project] = ids;
  }
  if (tabs !== undefined && (typeof tabs !== 'object' || tabs === null || JSON.stringify(tabs).length >= MAX_TABS_LAYOUT_BYTES)) return null;
  if (trees !== undefined && (!isStringArray(trees) || trees.length < 1 || trees.length > 2 || trees.some((id) => id.length > MAX_ID_LENGTH))) return null;
  const pair = treeSizes === undefined ? undefined : validPair(treeSizes);
  if (treeSizes !== undefined && !pair) return null;
  if (wrapLines !== undefined && typeof wrapLines !== 'boolean') return null;
  const sqlPair = sqlSizes === undefined ? undefined : validPair(sqlSizes);
  if (sqlSizes !== undefined && !sqlPair) return null;
  const conns = connections === undefined ? undefined : validConnections(connections);
  if (connections !== undefined && !conns) return null;
  return {
    sizes: [sizes[0], sizes[1]],
    collapsed,
    expanded: out,
    ...(trees !== undefined && { trees }),
    ...(pair && { treeSizes: pair }),
    ...(wrapLines !== undefined && { wrapLines }),
    ...(sqlPair && { sqlSizes: sqlPair }),
    ...(conns && { connections: conns }),
    ...(tabs !== undefined && { tabs }),
  };
}

type Stores = {
  projects: Parameters<typeof recordRoutes>[0];
  projectRoots: Parameters<typeof rootedFs>[0]['roots'];
  pickedFolders: ReturnType<typeof pickedPaths>;
  picks: DialogPicks;
};

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export interface ExplorerServerOptions {
  /** False: the delete route takes one path only. */
  multiDelete?: boolean;
}

export type ExplorerServerView = ServerViewDef<ExplorerServerSettings> & {
  /** A project folder as a terminal's working directory; valid once the view is mounted. */
  resolveCwd(root: string, path: string): Promise<string>;
};

/**
 * Server half of the Explorer view: the rooted file system routes, upload/download tickets, the
 * project record routes, reveal/open, the editors and folder dialog routes, and the `explorer`
 * settings group. Needs `ctx.stores.projects`, `projectRoots` and `pickedFolders`.
 */
export function explorerServerView(opts: ExplorerServerOptions = {}): ExplorerServerView {
  let fs: RootedFs | undefined;
  const mounted = () => {
    if (!fs) throw new Error('The Explorer view is not mounted.');
    return fs;
  };
  const view = defineServerView<ExplorerServerSettings>({
    id: 'explorer',
    icon: 'folder',
    shared: [
      { id: 'db', routes: (ctx) => dbSharedRoutes(ctx.stores as unknown as DbStores, ctx.dataDir) },
      { id: 'http', routes: (ctx) => httpSharedRoutes(ctx.stores as unknown as AppStores) },
    ],
    routes(ctx) {
      const stores = ctx.stores as unknown as Stores;
      const rooted = rootedFs({ multiDelete: opts.multiDelete, roots: stores.projectRoots, picks: stores.picks });
      fs = rooted;
      const target = async (json: <T>() => Promise<T>) => {
        const { root, path } = await json<{ root?: unknown; path?: unknown }>();
        return (await rooted.resolve(String(root), typeof path === 'string' ? path : '', { mustExist: true })).real;
      };
      void migrateConnections(ctx.settings);
      return {
        ...recordRoutes(stores.projects, '/api/projects'),
        ...rooted.routes,
        ...editorRoutes({ dir: ctx.dataDir, fs: rooted, picked: stores.pickedFolders }),
        'POST /api/fs/reveal': async ({ json }) => {
          await revealInFolder(await target(json)).catch(fromPlatform);
          return { ok: true };
        },
        'POST /api/fs/open': async ({ json }) => {
          await openWithDefault(await target(json)).catch(fromPlatform);
          return { ok: true };
        },
      };
    },
    unauthenticated: () => mounted().openRoutes,
    settings: { validate: { explorer: validExplorer, markdown: validMarkdown } },
  });
  return {
    ...view,
    async resolveCwd(root, path) {
      const { real } = await mounted().resolve(root, path, { mustExist: true });
      if (!isDirectory(real)) throw invalid('notADirectory', 'The path is not a folder.');
      return real;
    },
  };
}

/** Carries the Workbench's old `explorerConnections` into `explorer.connections` when the latter is unset. */
async function migrateConnections(settings: { load(): Promise<ExplorerServerSettings & { workbench?: { explorerConnections?: unknown } }>; save?(patch: Record<string, unknown>): Promise<unknown> }): Promise<void> {
  if (!settings.save) return;
  const s = await settings.load();
  const old = s.workbench?.explorerConnections;
  if (!s.explorer || s.explorer.connections !== undefined || !old) return;
  const connections = validConnections(old);
  if (connections) await settings.save({ explorer: { ...s.explorer, connections } });
}
