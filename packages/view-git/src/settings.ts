/** Change groups of the Git screen, VS Code's Source Control sections. */
export type GitSection = 'merge' | 'staged' | 'changes';

/** The stored Git screen state. */
export interface GitViewState {
  /** Id of the focused project. */
  project?: string;
  /** Fractions of the sidebar and the diff. */
  sizes?: [number, number];
  collapsed?: boolean;
  /** Changes as a flat list or nested under folders; list when omitted. */
  view?: 'list' | 'tree';
  /** Sections shown collapsed. */
  closedSections?: GitSection[];
  /** Whether the History panel under the changes is open; closed when omitted. */
  historyOpen?: boolean;
  /** Fraction of the sidebar height the open History panel takes. */
  historySize?: number;
}

/** The part of the app settings the Git view reads and writes; the app's `Settings` extends it. */
export interface GitViewSettings {
  /** State of the Git screen; the server validates it. */
  gitView?: GitViewState;
  /** Read only: the sidebar side of the app's window settings. */
  window?: { sidebarSide?: 'left' | 'right' };
  /** Read only: how the diff is laid out (the app's Git settings). */
  git?: { diffMode?: 'split' | 'inline' };
}
