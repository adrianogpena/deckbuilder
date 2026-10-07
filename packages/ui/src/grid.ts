/** Pure helpers for the panel grid (`PanelGrid`); ported from Dashboard's `PageGrid`. */

export interface GridItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
}

export interface PanelDef {
  id: string;
  title: string;
  icon: string;
  defaultSize: { w: number; h: number };
  minW: number;
  minH: number;
}

/** One entry of react-grid-layout's layout (the subset the grid uses). */
export interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  isResizable?: boolean;
}

export type Breakpoint = 'lg' | 'md' | 'sm';

export const BREAKPOINTS: Record<Breakpoint, number> = { lg: 1200, md: 768, sm: 0 };
export const COLS: Record<Breakpoint, number> = { lg: 12, md: 6, sm: 1 };
export const ROW_HEIGHT = 24;
export const COLLAPSED_H = 2;

export const breakpointOf = (width: number): Breakpoint =>
  width >= BREAKPOINTS.lg ? 'lg' : width >= BREAKPOINTS.md ? 'md' : 'sm';

/** Items to the grid's layout; unknown ids are dropped, a collapsed panel gets a fixed height. */
export function toGridLayout(items: readonly GridItem[], defs: readonly PanelDef[]): GridLayoutItem[] {
  return items.flatMap((item) => {
    const def = defs.find((d) => d.id === item.id);
    if (!def) return [];
    const { collapsed } = item;
    return [{
      i: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: collapsed ? COLLAPSED_H : item.h,
      minW: def.minW,
      minH: collapsed ? COLLAPSED_H : def.minH,
      isResizable: !collapsed,
    }];
  });
}

/** Moves the grid's positions back into the items; a collapsed panel keeps its expanded height. */
export function fromGridLayout(layout: readonly GridLayoutItem[], items: readonly GridItem[]): GridItem[] {
  return items.map((item) => {
    const l = layout.find((li) => li.i === item.id);
    if (!l) return item;
    return { ...item, x: l.x, y: l.y, w: l.w, h: item.collapsed ? item.h : l.h };
  });
}

export const sameGeometry = (a: readonly GridItem[], b: readonly GridItem[]): boolean =>
  a.length === b.length && a.every((x, i) => {
    const y = b[i];
    return !!y && x.id === y.id && x.x === y.x && x.y === y.y && x.w === y.w && x.h === y.h;
  });

type Box = Pick<GridItem, 'x' | 'y' | 'w' | 'h'>;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first free spot (top to bottom, left to right) where a `w`×`h` panel fits. */
export function findFreeSpot(items: readonly Box[], w: number, h: number, cols = COLS.lg): { x: number; y: number } {
  const width = Math.min(w, cols);
  const bottom = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + width <= cols; x++) {
      if (!items.some((i) => overlaps({ x, y, w: width, h }, i))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** Appends a panel at its default size on the first free spot. */
export function addItem(items: readonly GridItem[], def: PanelDef): GridItem[] {
  const { w, h } = def.defaultSize;
  return [...items, { id: def.id, ...findFreeSpot(items, w, h), w, h, collapsed: false }];
}
