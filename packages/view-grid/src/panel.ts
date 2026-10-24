import type { ComponentType, ReactNode } from 'react';
import { defaultConfig, type IconName, type PanelConfig, type PanelDef, type PanelField, type PanelKindSpec, type SidePanelContent } from '@deckbuilderkit/ui';

export interface PanelLoadContext {
  /** Aborted when the panel is removed, reconfigured or collapsed away. */
  signal: AbortSignal;
}

export interface PanelRenderProps<C, D> {
  /** The instance's config, cleaned and with defaults filled in. */
  config: C;
  /** What `load` returned; undefined for a kind without `load`. */
  data: D;
  /** Size in grid units. */
  size: { w: number; h: number };
  /** Loads again now (a no-op for a kind without `load`). */
  refresh(): void;
  /** Opens the panel's config dialog (a no-op when the host has none). */
  configure(): void;
  /** The instance id. */
  id: string;
  /** The view's side panel; absent when the host has none. */
  side?: PanelSide;
  /** Saves a new config for this instance; absent when the host cannot. */
  setConfig?(next: C): void;
}

export interface PanelSide {
  open(content: SidePanelContent, tab?: string): void;
  close(): void;
  isOpen(id: string): boolean;
}

export interface PanelKind<C extends PanelConfig = PanelConfig, D = any> {
  /** Kind id, stored in every instance. */
  kind: string;
  /** i18n key. */
  title: string;
  /** i18n key. */
  description: string;
  icon: IconName;
  /** i18n key of the group in the panel creator. */
  category?: string;
  /** Default and minimum size in grid units. */
  size: { w: number; h: number; minW: number; minH: number };
  /** Fields the instance's settings form is built from; none means nothing to configure. */
  config?: { fields: readonly PanelField[] };
  load?: (config: C, ctx: PanelLoadContext) => Promise<D>;
  /** Reload interval in milliseconds (0 or omitted: never). */
  refreshMs?: number | ((config: C, data: D | undefined) => number);
  render: (props: PanelRenderProps<C, D>) => ReactNode;
  /** Buttons in the panel header; call `requestRefresh(kind)` after changing data. */
  headerActions?: ComponentType<{ config: C; setConfig?(next: C): void; side?: PanelSide }>;
  /** Replaces the generic fields form in the config dialog and the panel creator. */
  configEditor?: ComponentType<{ value: C; onChange(next: C): void }>;
  /** More than one instance may be on the grid; true when omitted. */
  allowMultiple?: boolean;
}

const REFRESH_EVENT = 'grid:refresh';

/** Makes every mounted panel of `kind` load again now. */
export const requestRefresh = (kind: string) => window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: kind }));

/** Calls `run` when `requestRefresh` is called for `kind`; returns the unsubscribe. */
export function onRefreshRequest(kind: string, run: () => void): () => void {
  const handler = (e: Event) => {
    if ((e as CustomEvent<string>).detail === kind) run();
  };
  window.addEventListener(REFRESH_EVENT, handler);
  return () => window.removeEventListener(REFRESH_EVENT, handler);
}

/** Identity; types `config` and `data` of `render` from `load` and the fields. */
export function definePanel<C extends PanelConfig = PanelConfig, D = undefined>(def: PanelKind<C, D>): PanelKind<C, D> {
  return def;
}

export type AnyPanelKind = PanelKind<any, any>;

/** The fields of a kind, empty when it has none. */
export const fieldsOf = (kind: AnyPanelKind): readonly PanelField[] => kind.config?.fields ?? [];

export const kindSpecs = (kinds: readonly AnyPanelKind[]): Record<string, PanelKindSpec> =>
  Object.fromEntries(kinds.map((k) => [k.kind, { fields: k.config?.fields, allowMultiple: k.allowMultiple }]));

export const initialConfig = (kind: AnyPanelKind): PanelConfig => defaultConfig(fieldsOf(kind));

export const panelDef = (kind: AnyPanelKind, title: string): PanelDef => ({
  id: kind.kind,
  title,
  icon: kind.icon,
  defaultSize: { w: kind.size.w, h: kind.size.h },
  minW: kind.size.minW,
  minH: kind.size.minH,
});
