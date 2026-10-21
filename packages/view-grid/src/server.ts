import { defineServerView, type RouteContext, type Routes } from '@deckbuilderkit/server-core';
import { validConfig, validGridItems, type GridItem, type PanelConfig, type PanelField, type PanelKindSpec } from '@deckbuilderkit/ui/grid';

export { CLOCK_FIELDS, CLOCK_SPEC } from './clock-fields';
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
}

export interface DataSource<C extends PanelConfig = PanelConfig> {
  id: string;
  /** The config a panel sends; `fetch` receives it cleaned by `validConfig`. */
  fields: readonly PanelField[];
  /** Returns JSON-serializable data for a panel's `load` (see `fetchSource`). */
  fetch(config: C, ctx: SourceContext): Promise<unknown> | unknown;
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

/** The handlers of `sources`: the body is `{ config }`, cleaned with the source's fields before `fetch`. */
export function sourceRoutes(sources: readonly DataSource<any>[], dataDir = ''): Routes {
  return Object.fromEntries(
    sources.map((source) => [
      sourceRoute(source.id),
      async ({ json, req }: RouteContext) => {
        const body = await json<{ config?: unknown }>();
        return source.fetch(validConfig(source.fields, body.config), { dataDir, signal: req.signal });
      },
    ]),
  );
}

/** Server half of the Grid view: validates `gridLayout` in the settings and serves the data sources. */
export function gridServerView({ panels, sources = [] }: GridServerOptions) {
  const specs = kindSpecsOf(panels);
  const ids = new Set<string>();
  for (const s of sources) {
    if (ids.has(s.id) || !/^[a-z0-9-]+$/.test(s.id)) throw new Error(`Invalid or duplicate grid source id: ${s.id}`);
    ids.add(s.id);
  }
  return defineServerView<GridServerSettings>({
    id: 'grid',
    routes: (ctx): Routes => sourceRoutes(sources, ctx.dataDir),
    settings: { validate: { gridLayout: (raw) => validGridItems(raw, specs) } },
  });
}
