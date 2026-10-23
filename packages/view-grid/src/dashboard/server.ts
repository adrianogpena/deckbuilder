import { defineServerView, type Routes } from '@deckbuilderkit/server-core';
import { connectionRoutes } from '../connections/routes';
import { checkSources, kindSpecsOf, sourceRoutes, type DataSource, type GridPanelSpec } from '../server';
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
  checkSources(sources, 'dashboard');
  return defineServerView<DashboardServerSettings>({
    id: 'dashboard',
    icon: 'cube',
    routes: (ctx): Routes => ({ ...sourceRoutes(sources, ctx.dataDir), ...connectionRoutes(ctx.dataDir) }),
    settings: {
      validate: {
        dashboardLayouts: (raw) => validDashboardLayouts(raw, specs),
        dashboardPresets: (raw) => validDashboardPresets(raw, specs),
      },
    },
  });
}
