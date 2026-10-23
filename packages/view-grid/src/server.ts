import { defineServerView, type RouteContext, type Routes } from '@deckbuilderkit/server-core';
import { validConfig, validGridItems, type GridItem, type PanelConfig, type PanelField, type PanelKindSpec } from '@deckbuilderkit/ui/grid';

import { type ResolvedConnection } from './connections/auth';
import { connectionResolverOf } from './connections/routes';
import { type ConnectionType } from './connections/store';

export { CLOCK_FIELDS, CLOCK_SPEC } from './clock-fields';
export { authHeader, type ResolvedConnection } from './connections/auth';
export { codeForStatus, SourceError, sourceFetch, type SourceErrorCode } from './connections/errors';
export { type Connection, type ConnectionType, type PublicConnection } from './connections/store';
export { dashboardServerView, type DashboardServerOptions, type DashboardServerSettings } from './dashboard/server';
export { dashboardSources, dashboardSpecs } from './panels/catalog.server';

/** The part of the server settings the Grid view owns; the app's `Settings` extends it. */
export interface GridServerSettings {
  /** Layout of the Grid screen, checked by `validGridItems` against the registered panel kinds. */
  gridLayout?: GridItem[];
}

/** What the server knows of a panel kind: its id and what `validGridItems` needs. */
export type GridPanelSpec = PanelKindSpec & { kind: string };

export interface SourceContext {
  dataDir: string;
  signal: AbortSignal;
  /** The credentials of connection `id` (`not-configured` when unknown or of another type). */
  connection(id: string, type: ConnectionType): Promise<ResolvedConnection>;
}

export interface DataSource<C extends PanelConfig = PanelConfig> {
  id: string;
  /** The config a panel sends; `fetch` receives it cleaned by `validConfig`. */
  fields: readonly PanelField[];
  /** Returns JSON-serializable data for a panel's `load` (see `fetchSource`). */
  fetch(config: C, ctx: SourceContext): Promise<unknown> | unknown;
  /** Writes behind `POST /api/grid/action/<id>/<name>`; the body is `{ config, payload }`. */
  actions?: Record<string, (payload: unknown, config: C, ctx: SourceContext) => unknown | Promise<unknown>>;
  /** NDJSON streams behind `GET /api/grid/stream/<id>/<name>`; build the body with server-core `ndjson(req, produce)`. */
  streams?: Record<string, (query: URLSearchParams, ctx: SourceContext & { req: Request }) => Response>;
}

/** Identity; types `config` of `fetch`. */
export function defineSource<C extends PanelConfig = PanelConfig>(def: DataSource<C>): DataSource<C> {
  return def;
}

export interface GridServerOptions {
  /** Every panel kind the app's grid can hold. */
  panels: readonly GridPanelSpec[];
  /** Data sources behind `POST /api/grid/source/<id>`, for kinds that load from the server (Jira, GitHub…). */
  sources?: readonly DataSource<any>[];
}

export const kindSpecsOf = (panels: readonly GridPanelSpec[]): Record<string, PanelKindSpec> =>
  Object.fromEntries(panels.map((p) => [p.kind, { fields: p.fields, allowMultiple: p.allowMultiple }]));

/** The route of data source `id`. */
export const sourceRoute = (id: string): string => `POST /api/grid/source/${id}`;

/** The route of action `name` of data source `id`. */
export const actionRoute = (id: string, name: string): string => `POST /api/grid/action/${id}/${name}`;

/** The route of stream `name` of data source `id`. */
export const streamRoute = (id: string, name: string): string => `GET /api/grid/stream/${id}/${name}`;

const NAME_RE = /^[a-z0-9-]+$/;

/** Throws when a source id, or one of its action or stream names, is invalid or duplicated. */
export function checkSources(sources: readonly DataSource<any>[], label: string): void {
  const ids = new Set<string>();
  for (const s of sources) {
    if (ids.has(s.id) || !NAME_RE.test(s.id)) throw new Error(`Invalid or duplicate ${label} source id: ${s.id}`);
    ids.add(s.id);
    for (const name of [...Object.keys(s.actions ?? {}), ...Object.keys(s.streams ?? {})]) {
      if (!NAME_RE.test(name)) throw new Error(`Invalid ${label} action or stream name: ${s.id}/${name}`);
    }
  }
}

/** The handlers of `sources`: the body is `{ config }`, cleaned with the source's fields before `fetch`; plus their actions and streams. */
export function sourceRoutes(sources: readonly DataSource<any>[], dataDir = ''): Routes {
  const connection = connectionResolverOf(dataDir);
  const routes: Routes = {};
  for (const source of sources) {
    routes[sourceRoute(source.id)] = async ({ json, req }: RouteContext) => {
      const body = await json<{ config?: unknown }>();
      return source.fetch(validConfig(source.fields, body.config), { dataDir, signal: req.signal, connection });
    };
    for (const [name, action] of Object.entries(source.actions ?? {})) {
      routes[actionRoute(source.id, name)] = async ({ json, req }: RouteContext) => {
        const body = await json<{ config?: unknown; payload?: unknown }>();
        return (await action(body.payload, validConfig(source.fields, body.config), { dataDir, signal: req.signal, connection })) ?? null;
      };
    }
    for (const [name, stream] of Object.entries(source.streams ?? {})) {
      routes[streamRoute(source.id, name)] = ({ query, req }: RouteContext) => stream(query, { dataDir, signal: req.signal, connection, req });
    }
  }
  return routes;
}

/** Server half of the Grid view: validates `gridLayout` in the settings and serves the data sources. */
export function gridServerView({ panels, sources = [] }: GridServerOptions) {
  const specs = kindSpecsOf(panels);
  checkSources(sources, 'grid');
  return defineServerView<GridServerSettings>({
    id: 'grid',
    icon: 'cube',
    routes: (ctx): Routes => sourceRoutes(sources, ctx.dataDir),
    settings: { validate: { gridLayout: (raw) => validGridItems(raw, specs) } },
  });
}
