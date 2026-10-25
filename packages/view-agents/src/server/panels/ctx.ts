import type { Routes } from '@kedalion/server-core';
import type { AgentProject } from '../../protocol.ts';
import type { createSessionScanner } from '../discovery.ts';

/**
 * What a panel's `routes(ctx)` gets. Panel route files (`server/panels/<kind>.ts`) use only this object, so a
 * panel never edits `server.ts`.
 */
export interface PanelCtx {
  /** App data dir (`~/.deckbuilder`); panels keep files under `agentsDir`. */
  dataDir: string;
  /** `<dataDir>/agents`: the Agents view's own folder. */
  agentsDir: string;
  /** App settings: `load()` the current ones, `save` a patch (absent in tests). */
  settings: { load(): Promise<{ agents?: unknown } & Record<string, unknown>>; save?(patch: Record<string, unknown>): Promise<unknown> };
  /** The app's record stores (e.g. `projects`). */
  stores: Record<string, unknown>;
  /** The projects added to the Agents view. */
  projects(): AgentProject[];
  /** The folder of a project given its id or its path (any slash/case spelling); undefined when it is not an added project. */
  projectRoot(project: string): string | undefined;
  /** The config folders of the Claude accounts (each has `projects/`). */
  accountDirs?(): string[];
  /** The transcript scanner shared with the session list. */
  scanner: ReturnType<typeof createSessionScanner>;
  /** Shows an OS toast (clicking it opens `launch`, an app link, when set). */
  notify(toast: { title: string; body: string; launch?: string }): void;
}

/** A panel's route file: `export const routes = (ctx) => ({ 'GET /api/agents/<kind>/...': handler })`. */
export type PanelRoutes = (ctx: PanelCtx) => Routes;
