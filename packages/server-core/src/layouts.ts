// Layouts: switchable structural looks. A layout's CSS lives in `packages/ui/src/layouts/<id>.css`,
// scoped under `:root[data-layout='<id>']`; `original` has no file (it is the base styles.css).
// A layout also declares its screen structure (`LayoutStructure`) and its default icon set.
// Pure module, shared by the server (settings validation) and the web UI (applies `data-layout`).

export interface LayoutStructure {
  sidebarSide: 'left' | 'right';
  sidebarMode: 'collapsed' | 'expanded';
  /** Brand row at the top of the sidebar. */
  sidebarBrand: boolean;
  tabBarPosition: 'top' | 'bottom';
  /** False: the StatusBar renders nothing (the user setting `window.statusBar` still applies when true). */
  statusBar: boolean;
  /** 'none': the Sidebar drops its footer; a swapped Frame can show the tools elsewhere. */
  navFooter: 'sidebar' | 'none';
}

export type MainMenu = 'labels' | 'icons';

/** True when the structure shows a labelled main menu (an expanded sidebar). */
export function hasLabelledMenu(s: LayoutStructure): boolean {
  return s.sidebarMode === 'expanded';
}

/** The structure with the main menu style applied: 'icons' collapses an expanded sidebar. */
export function applyMainMenu(s: LayoutStructure, mode?: MainMenu): LayoutStructure {
  return mode === 'icons' && s.sidebarMode === 'expanded' ? { ...s, sidebarMode: 'collapsed' } : s;
}

/** Layouts whose navigation is a header (or otherwise not a side dock): the dock side does not apply. */
export const HEADER_NAV_LAYOUTS: readonly string[] = ['ribbon', 'ledger', 'atlas'];

export function supportsDock(layoutId: string): boolean {
  return !HEADER_NAV_LAYOUTS.includes(layoutId);
}

/** The structure with the dock side applied; unset keeps the layout's own side. */
export function applyDockSide(s: LayoutStructure, side?: 'left' | 'right'): LayoutStructure {
  return side && side !== s.sidebarSide ? { ...s, sidebarSide: side } : s;
}

/** Ids of the brand marks (one per designed layout), selectable as the layout icon. */
export const LAYOUT_MARK_IDS: readonly string[] = [
  'original', 'dense', 'calm', 'dock-right', 'material', 'labeled', 'blueprint', 'islands', 'transit', 'modeline', 'ribbon', 'ledger', 'atlas',
];

export interface Layout {
  id: string;
  label: string;
  /** Default icon-set id, one of ICON_SET_IDS. */
  icons: string;
  structure: LayoutStructure;
}

export const DEFAULT_LAYOUT = 'original';

export const ORIGINAL_STRUCTURE: LayoutStructure = {
  sidebarSide: 'left',
  sidebarMode: 'collapsed',
  sidebarBrand: true,
  tabBarPosition: 'top',
  statusBar: true,
  navFooter: 'sidebar',
};

export const LAYOUTS: readonly Layout[] = [{ id: 'original', label: 'Original', icons: 'original', structure: ORIGINAL_STRUCTURE }];

export const ICON_SET_IDS: readonly string[] = ['original', 'material', 'atom'];

export function layoutById(id: string): Layout | undefined {
  return LAYOUTS.find((l) => l.id === id);
}

/** The layout for `id`; unknown or unset gives the default. */
export function resolveLayout(id?: string): Layout {
  return (id === undefined ? undefined : layoutById(id)) ?? layoutById(DEFAULT_LAYOUT)!;
}

/** The icon set to use: `override` when it is a known id, else the layout's own. */
export function resolveIconSetId(layout: Layout, override?: string): string {
  return override !== undefined && ICON_SET_IDS.includes(override) ? override : layout.icons;
}
