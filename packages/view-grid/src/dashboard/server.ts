import { defineServerView, type Routes } from '@deckbuilderkit/server-core';
import { kindSpecsOf, sourceRoutes, type DataSource, type GridPanelSpec } from '../server';
import { validDashboardLayouts, validDashboardPresets, type DashboardLayouts, type DashboardPreset } from './model';

/** The part of the server settings the Dashboard view owns; the app's `Settings` extends it. */
export interface DashboardServerSettings {
  /** Named layouts and the active one, checked by `validDashboardLayouts`. */
  dashboardLayouts?: DashboardLayouts;
  /** Saved panel presets, checked by `validDashboardPresets`. */
  dashboardPresets?: DashboardPreset[];
}

export interface DashboardServerOptions {
  /** Every panel kind the dashboard can hold. */
  panels: readonly GridPanelSpec[];
  /** Data sources behind `POST /api/grid/source/<id>`. */
  sources?: readonly DataSource<any>[];
}

/** Server half of the Dashboard view: validates `dashboardLayouts` and `dashboardPresets` and serves the data sources. */
export function dashboardServerView({ panels, sources = [] }: DashboardServerOptions) {
  const specs = kindSpecsOf(panels);
  const ids = new Set<string>();
  for (const s of sources) {
    if (ids.has(s.id) || !/^[a-z0-9-]+$/.test(s.id)) throw new Error(`Invalid or duplicate dashboard source id: ${s.id}`);
    ids.add(s.id);
  }
  return defineServerView<DashboardServerSettings>({
    id: 'dashboard',
    routes: (ctx): Routes => sourceRoutes(sources, ctx.dataDir),
    settings: {
      validate: {
        dashboardLayouts: (raw) => validDashboardLayouts(raw, specs),
        dashboardPresets: (raw) => validDashboardPresets(raw, specs),
      },
    },
  });
}
