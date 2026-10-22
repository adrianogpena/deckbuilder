import { isRecord } from './protocol.ts';
import type { Routes, SocketRoutes } from './server.ts';

export type FieldSpec = 'boolean' | 'string' | readonly [min: number, max: number] | readonly string[];

/** A copy of `raw` when every key is in `spec` and its value fits, else null. */
export function validGroup(raw: unknown, spec: Record<string, FieldSpec>): Record<string, string | number | boolean> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!Object.hasOwn(spec, key)) return null;
    const s = spec[key]!;
    if (s === 'boolean') {
      if (typeof v !== 'boolean') return null;
    } else if (s === 'string') {
      if (typeof v !== 'string' || v.length > 300) return null;
    } else if (typeof s[0] === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < s[0] || v > (s[1] as number)) return null;
    } else if (typeof v !== 'string' || !(s as readonly string[]).includes(v)) return null;
    out[key] = v;
  }
  return out;
}

/** The shared `git` settings group (Git view and Explorer decorations). */
export const GIT_SPEC: Record<string, FieldSpec> = {
  diffMode: ['split', 'inline'],
  explorerDecorations: 'boolean',
};

export interface ServerViewContext<S> {
  dataDir: string;
  settings: { load(): Promise<S>; save?(patch: Record<string, unknown>): Promise<unknown> };
  stores: Record<string, unknown>;
  options?: unknown;
}

export interface ServerViewDef<S = any> {
  id: string;
  /** Icon name (as the web view's `nav.icon`) shown on this view's OS notifications. */
  icon?: string;
  routes(ctx: ServerViewContext<S>): Routes;
  sockets?(ctx: ServerViewContext<S>): SocketRoutes;
  /** Routes outside the session token check (see `ServerOptions.unauthenticated`); each handler checks its own credentials. */
  unauthenticated?(ctx: ServerViewContext<S>): Routes;
  /**
   * Route groups several views need (e.g. `/api/db/*` for Workbench and Explorer): `mountViews` mounts
   * each `id` once, using the first view that lists it.
   */
  shared?: ReadonlyArray<{ id: string; routes(ctx: ServerViewContext<S>): Routes }>;
  onQuit?(): void | Promise<void>;
  /** Asked before a user-initiated quit: a message to confirm (default No) when quitting would stop running work, else undefined. */
  quitGuard?(): string | undefined | Promise<string | undefined>;
  settings?: {
    /** Group key -> validator returning the clean value, or null when invalid. */
    validate: Record<string, (raw: unknown) => unknown | null>;
    spec?: Record<string, FieldSpec>;
    /**
     * Runs before a save (see `checkViewSettings`) with the raw patch and the current settings;
     * throws (an `invalid` AppError) to reject the whole save. May ask the user.
     */
    check?(patch: Record<string, unknown>, prev: Record<string, unknown>): Promise<void>;
  };
}

export function defineServerView<S = any>(def: ServerViewDef<S>): ServerViewDef<S> {
  return def;
}

/** View id -> icon name lookup over `defs`, for the notifications `viewIcons` option. */
export function viewIcons(defs: readonly ServerViewDef[]): (id: string) => string | undefined {
  return (id) => defs.find((d) => d.id === id)?.icon;
}

/**
 * For the settings store `apply`: copies each group of `patch` that a view validates into `next`;
 * groups unknown to every view or failing validation are skipped.
 */
export function applyViewSettings(defs: readonly ServerViewDef[], patch: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const d of defs) {
    for (const [group, validate] of Object.entries(d.settings?.validate ?? {})) {
      if (!Object.hasOwn(patch, group)) continue;
      const v = validate(patch[group]);
      if (v !== null) next[group] = v;
    }
  }
}

/** For the settings store `check`: runs every view's `settings.check`, in order; the first throw rejects the save. */
export async function checkViewSettings(defs: readonly ServerViewDef[], patch: Record<string, unknown>, prev: Record<string, unknown>): Promise<void> {
  for (const d of defs) await d.settings?.check?.(patch, prev);
}

export function mountViews<S>(
  defs: readonly ServerViewDef<S>[],
  ctx: ServerViewContext<S>,
): { routes: Routes; sockets: SocketRoutes; unauthenticated: Routes; onQuit(): Promise<void>; quitGuard(): Promise<string[]> } {
  const ids = new Set<string>();
  const sharedIds = new Set<string>();
  const routes: Routes = {};
  const sockets: SocketRoutes = {};
  const unauthenticated: Routes = {};
  for (const d of defs) {
    if (ids.has(d.id)) throw new Error(`View already registered: ${d.id}`);
    ids.add(d.id);
    for (const [key, h] of Object.entries(d.routes(ctx))) {
      if (Object.hasOwn(routes, key)) throw new Error(`Duplicate route: ${key} (view ${d.id})`);
      routes[key] = h;
    }
    for (const s of d.shared ?? []) {
      if (sharedIds.has(s.id)) continue;
      sharedIds.add(s.id);
      for (const [key, h] of Object.entries(s.routes(ctx))) {
        if (Object.hasOwn(routes, key)) throw new Error(`Duplicate route: ${key} (shared ${s.id})`);
        routes[key] = h;
      }
    }
    for (const [key, h] of Object.entries(d.unauthenticated?.(ctx) ?? {})) {
      if (Object.hasOwn(unauthenticated, key)) throw new Error(`Duplicate unauthenticated route: ${key} (view ${d.id})`);
      unauthenticated[key] = h;
    }
    for (const [path, s] of Object.entries(d.sockets?.(ctx) ?? {})) {
      if (Object.hasOwn(sockets, path)) throw new Error(`Duplicate socket: ${path} (view ${d.id})`);
      sockets[path] = s;
    }
  }
  return {
    routes,
    sockets,
    unauthenticated,
    async onQuit() {
      for (const d of defs) await d.onQuit?.();
    },
    async quitGuard() {
      const out: string[] = [];
      for (const d of defs) {
        const m = await d.quitGuard?.();
        if (m) out.push(m);
      }
      return out;
    },
  };
}
