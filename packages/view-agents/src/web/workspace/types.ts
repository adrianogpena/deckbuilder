import type { ComponentType } from 'react';
import type { IconName } from '@deckbuilderkit/ui';
import type { AgentsMessageKey } from '../../i18n';

/** Every tool of the Agents view; each has a folder `panels/<kind>/` exporting a `PanelModule` named `panel`. */
export const PANEL_KINDS = ['terminal', 'agent', 'changes', 'diff', 'review', 'usage', 'run', 'scratchpad', 'files', 'code', 'preview', 'json', 'task', 'notes', 'trajectory', 'skills'] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** What a tab saves: the panel kind and its params (terminal session id, cwd, title; diff path; tool params). */
export type PanelParams = Record<string, unknown>;

/** The route of a workspace tab (what `serialize` saves per tab). `kind` may be one this build does not know: it shows a "missing panel" card. */
export interface PanelRoute {
  kind: string;
  params: PanelParams;
}

export type Placement = 'center' | 'sidebar' | 'both';
export type AddMenu = 'terminal' | 'agents' | 'tools';

export interface OpenOptions {
  /** Where the panel docks; default: the panel's own (`center` for `both`). */
  placement?: 'center' | 'sidebar';
  /** Tab id to open next to (same pane; a new split when that pane is the only one). */
  beside?: string;
}

/** What a panel (and a command) can do to the workspace of its project. */
export interface WorkspaceApi {
  /**
   * Opens a panel and returns its tab id. A `single` kind already open is focused instead (its params are merged in).
   * With `placement: 'sidebar'` the sidebar card is shown (needs `capabilities.sidebarCards`).
   */
  open(kind: PanelKind, params?: PanelParams, opts?: OpenOptions): string;
  /** Selects the tab and focuses its pane. */
  focus(id: string): void;
  /** Closes the tab (a terminal tab also ends its shell). */
  close(id: string): void;
  /** Moves a tool between the workspace and the sidebar (sidebar side: group g2). */
  moveTo(id: string, to: 'center' | 'sidebar'): void;
  /** Inserts text into the Claude session's terminal (no Enter). */
  sendToSession(sessionId: string, text: string): void;
  /** Folder of the project the workspace belongs to; undefined when none is selected. */
  activeProject: string | undefined;
}

export interface PanelProps {
  /** Folder of the project this workspace belongs to. */
  project: string;
  params: PanelParams;
  api: WorkspaceApi;
  /** Id of the tab showing the panel (`api.close(tabId)` closes itself). */
  tabId: string;
  /** The tab is the selected one of its pane and its workspace is the shown one. */
  visible: boolean;
  /** Visible and its pane has the focus. */
  focused: boolean;
  /** Merges `patch` into the tab's saved params (a `undefined` value removes the key). */
  update(patch: PanelParams): void;
}

export interface SectionProps {
  /** Folder of the selected project; undefined when none. */
  project: string | undefined;
  api: WorkspaceApi;
}

/** A shortcut a panel adds: `key` is the default chord (e.g. `Ctrl+Shift+G`). */
export interface PanelCommand {
  id: string;
  key: string;
  run(api: WorkspaceApi): void;
}

export interface PanelModule {
  kind: PanelKind;
  /** Message key of the tab title and menu entry. */
  titleKey: AgentsMessageKey;
  icon: IconName;
  /** The center component. */
  Panel: ComponentType<PanelProps>;
  /** Body of the sidebar card (placement `sidebar` or `both`). */
  Section?: ComponentType<SectionProps>;
  placement: Placement;
  /** One instance anywhere: opening it again focuses the open one. */
  single?: boolean;
  /** Section of the pane "+" menu that lists the panel. */
  addMenu?: AddMenu;
  commands?: PanelCommand[];
  /** Not built yet: the "+" menu marks it "Coming soon". Drop it when the panel is real. */
  comingSoon?: boolean;
}
