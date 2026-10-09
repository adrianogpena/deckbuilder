/**
 * Tabs and split panes. Pure functions over a serializable Layout so the app
 * can persist it and every change is easy to reason about. Generic over the
 * route type R: what a tab shows is up to the app.
 */

export interface Tab<R> {
  id: string;
  route: R;
  back: R[];
  forward: R[];
}

export interface Pane<R> {
  id: string;
  tabs: Tab<R>[];
  active: string;
}

/** How panes are arranged: a pane, or panes side by side (`row`) or stacked (`column`). */
export type SplitNode = { pane: string } | { dir: 'row' | 'column'; children: SplitNode[]; sizes: number[] };

export interface Layout<R> {
  panes: Pane<R>[];
  focused: string;
  /** Absent: one row of `panes` in order (layouts saved before split down). */
  tree?: SplitNode;
}

export const MAX_PANES = 4;
const MAX_HISTORY = 50;
const MAX_DEPTH = 4;

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function newTab<R>(route: R): Tab<R> {
  return { id: uid('t'), route, back: [], forward: [] };
}

export function singlePane<R>(tab: Tab<R>): Layout<R> {
  const pane: Pane<R> = { id: uid('p'), tabs: [tab], active: tab.id };
  return { panes: [pane], focused: pane.id };
}

export function focusedPane<R>(layout: Layout<R>): Pane<R> {
  return layout.panes.find((p) => p.id === layout.focused) ?? layout.panes[0];
}

export function activeTab<R>(layout: Layout<R>): Tab<R> {
  const pane = focusedPane(layout);
  return pane.tabs.find((t) => t.id === pane.active) ?? pane.tabs[0];
}

export function findTab<R>(layout: Layout<R>, tabId: string): Tab<R> | undefined {
  for (const p of layout.panes) {
    const t = p.tabs.find((x) => x.id === tabId);
    if (t) return t;
  }
  return undefined;
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);

/** The pane arrangement; a layout without `tree` is one row of its panes. */
export function layoutTree<R>(layout: Layout<R>): SplitNode {
  if (layout.tree) return layout.tree;
  if (layout.panes.length === 1) return { pane: layout.panes[0].id };
  return { dir: 'row', children: layout.panes.map((p) => ({ pane: p.id })), sizes: equal(layout.panes.length) };
}

/**
 * Drops the panes not in `keep`: their size goes to the remaining siblings in proportion, a split
 * left with one child becomes that child, and a child split in the parent's direction merges into it.
 */
function pruneTree(node: SplitNode, keep: Set<string>): SplitNode | null {
  if ('pane' in node) return keep.has(node.pane) ? node : null;
  const children: SplitNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const kept = pruneTree(child, keep);
    if (!kept) return;
    if (!('pane' in kept) && kept.dir === node.dir) {
      children.push(...kept.children);
      sizes.push(...kept.sizes.map((s) => s * node.sizes[i]));
    } else {
      children.push(kept);
      sizes.push(node.sizes[i]);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const sum = sizes.reduce((a, b) => a + b, 0);
  return { dir: node.dir, children, sizes: sizes.map((s) => s / sum) };
}

/** `layout` with `panes`; its tree loses the panes that are gone, a layout without a tree stays without. */
function withPanes<R>(layout: Layout<R>, panes: Pane<R>[], focused: string): Layout<R> {
  const tree = layout.tree && pruneTree(layout.tree, new Set(panes.map((p) => p.id)));
  return tree ? { panes, focused, tree } : { panes, focused };
}

function mapTab<R>(layout: Layout<R>, tabId: string, fn: (t: Tab<R>) => Tab<R>): Layout<R> {
  return {
    ...layout,
    panes: layout.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? fn(t) : t)) })),
  };
}

function sameRoute<R>(a: R, b: R): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Changes what a tab shows, recording the previous route for Back. */
export function navigate<R>(layout: Layout<R>, tabId: string, route: R, opts: { replace?: boolean } = {}): Layout<R> {
  return mapTab(layout, tabId, (t) => {
    if (sameRoute(route, t.route)) return t;
    if (opts.replace) return { ...t, route };
    return { ...t, route, back: [...t.back, t.route].slice(-MAX_HISTORY), forward: [] };
  });
}

export function goBack<R>(layout: Layout<R>, tabId: string): Layout<R> {
  return mapTab(layout, tabId, (t) => {
    if (!t.back.length) return t;
    const prev = t.back[t.back.length - 1];
    return { ...t, route: prev, back: t.back.slice(0, -1), forward: [t.route, ...t.forward] };
  });
}

export function goForward<R>(layout: Layout<R>, tabId: string): Layout<R> {
  return mapTab(layout, tabId, (t) => {
    if (!t.forward.length) return t;
    return { ...t, route: t.forward[0], back: [...t.back, t.route], forward: t.forward.slice(1) };
  });
}

export function activate<R>(layout: Layout<R>, paneId: string, tabId: string): Layout<R> {
  return {
    ...layout,
    focused: paneId,
    panes: layout.panes.map((p) => (p.id === paneId ? { ...p, active: tabId } : p)),
  };
}

/** Adds a tab next to the active one in the given pane (focused pane by default) and selects it. */
export function addTab<R>(layout: Layout<R>, tab: Tab<R>, paneId = layout.focused): Layout<R> {
  return {
    ...layout,
    focused: paneId,
    panes: layout.panes.map((p) => {
      if (p.id !== paneId) return p;
      const at = p.tabs.findIndex((t) => t.id === p.active);
      const tabs = [...p.tabs];
      tabs.splice(at + 1, 0, tab);
      return { ...p, tabs, active: tab.id };
    }),
  };
}

/** Closes a tab; an emptied pane disappears, and the last tab is replaced by `fallback`. */
export function closeTab<R>(layout: Layout<R>, tabId: string, fallback: () => Tab<R>): Layout<R> {
  const panes: Pane<R>[] = [];
  let focused = layout.focused;
  for (const p of layout.panes) {
    const idx = p.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) {
      panes.push(p);
      continue;
    }
    const tabs = p.tabs.filter((t) => t.id !== tabId);
    if (!tabs.length) {
      if (focused === p.id) focused = '';
      continue;
    }
    const active = p.active === tabId ? tabs[Math.min(idx, tabs.length - 1)].id : p.active;
    panes.push({ ...p, tabs, active });
  }
  if (!panes.length) return singlePane(fallback());
  if (!panes.some((p) => p.id === focused)) focused = panes[panes.length - 1].id;
  return withPanes(layout, panes, focused);
}

/** Puts pane `added` next to pane `at` in direction `dir`: as a sibling when the parent split has that direction. */
function insertNext(node: SplitNode, at: string, added: string, dir: 'row' | 'column'): SplitNode {
  if ('pane' in node) return node.pane === at ? { dir, children: [node, { pane: added }], sizes: [0.5, 0.5] } : node;
  const i = node.children.findIndex((c) => 'pane' in c && c.pane === at);
  if (i >= 0 && node.dir === dir) {
    const children = [...node.children];
    const sizes = [...node.sizes];
    children.splice(i + 1, 0, { pane: added });
    sizes.splice(i, 1, node.sizes[i] / 2, node.sizes[i] / 2);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => insertNext(c, at, added, dir)) };
}

/**
 * Opens a copy of the tab in a new pane to the right of or below its pane (or in the next pane
 * when already at the limit).
 */
export function splitPane<R>(layout: Layout<R>, tabId: string, side: 'right' | 'down'): Layout<R> {
  const source = findTab(layout, tabId);
  if (!source) return layout;
  const copy = newTab(source.route);
  const at = layout.panes.findIndex((p) => p.tabs.some((t) => t.id === tabId));
  if (layout.panes.length >= MAX_PANES) {
    const target = layout.panes[Math.min(at + 1, layout.panes.length - 1)];
    return addTab(layout, copy, target.id === layout.panes[at].id ? layout.panes[0].id : target.id);
  }
  const pane: Pane<R> = { id: uid('p'), tabs: [copy], active: copy.id };
  const panes = [...layout.panes];
  panes.splice(at + 1, 0, pane);
  const tree = insertNext(layoutTree(layout), layout.panes[at].id, pane.id, side === 'right' ? 'row' : 'column');
  return { panes, focused: pane.id, tree };
}

export function splitRight<R>(layout: Layout<R>, tabId: string): Layout<R> {
  return splitPane(layout, tabId, 'right');
}

/** Sets the sizes of the split at `path` (child indexes from the root); a wrong path or count changes nothing. */
export function resizeSplit<R>(layout: Layout<R>, path: number[], sizes: number[]): Layout<R> {
  const set = (node: SplitNode, depth: number): SplitNode | null => {
    if ('pane' in node) return null;
    if (depth === path.length) return sizes.length === node.children.length ? { ...node, sizes: [...sizes] } : null;
    const i = path[depth];
    const next = node.children[i] && set(node.children[i], depth + 1);
    return next ? { ...node, children: node.children.map((c, j) => (j === i ? next : c)) } : null;
  };
  const tree = set(layoutTree(layout), 0);
  return tree ? { ...layout, tree } : layout;
}

/** Moves a tab to another pane (used by drag and drop between tab bars). */
export function moveTab<R>(layout: Layout<R>, tabId: string, toPane: string, index?: number): Layout<R> {
  const tab = findTab(layout, tabId);
  if (!tab) return layout;
  const without = closeTab(layout, tabId, () => tab);
  if (!without.panes.some((p) => p.id === toPane)) return layout;
  return {
    ...without,
    focused: toPane,
    panes: without.panes.map((p) => {
      if (p.id !== toPane) return p;
      const tabs = p.tabs.filter((t) => t.id !== tabId);
      tabs.splice(index ?? tabs.length, 0, tab);
      return { ...p, tabs, active: tab.id };
    }),
  };
}

export function cycleTab<R>(layout: Layout<R>, step: 1 | -1): Layout<R> {
  const pane = focusedPane(layout);
  const idx = pane.tabs.findIndex((t) => t.id === pane.active);
  const next = pane.tabs[(idx + step + pane.tabs.length) % pane.tabs.length];
  return activate(layout, pane.id, next.id);
}

/** Selects the tab at `index` in the focused pane; an index past the end selects the last tab. */
export function selectIndex<R>(layout: Layout<R>, index: number): Layout<R> {
  const pane = focusedPane(layout);
  const tab = index >= pane.tabs.length ? pane.tabs[pane.tabs.length - 1] : pane.tabs[index];
  return tab ? activate(layout, pane.id, tab.id) : layout;
}

/** Snapshot to persist: no history. */
export function serialize<R>(layout: Layout<R>): unknown {
  return {
    focused: layout.focused,
    panes: layout.panes.map((p) => ({ id: p.id, active: p.active, tabs: p.tabs.map((t) => ({ id: t.id, route: t.route })) })),
    ...(layout.tree ? { tree: layout.tree } : {}),
  };
}

/** A copy of a saved tree when it is well formed, each leaf's pane id added to `leaves`; else null. */
function readTree(raw: unknown, depth: number, leaves: string[]): SplitNode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const node = raw as { pane?: unknown; dir?: unknown; children?: unknown; sizes?: unknown };
  if (typeof node.pane === 'string') {
    leaves.push(node.pane);
    return { pane: node.pane };
  }
  if (depth >= MAX_DEPTH || (node.dir !== 'row' && node.dir !== 'column')) return null;
  const { children, sizes } = node;
  if (!Array.isArray(children) || !Array.isArray(sizes) || children.length < 2 || sizes.length !== children.length) return null;
  if (!sizes.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) return null;
  if (Math.abs(sizes.reduce((a, b) => a + b, 0) - 1) > 0.01) return null;
  const read: SplitNode[] = [];
  for (const c of children) {
    const child = readTree(c, depth + 1, leaves);
    if (!child) return null;
    read.push(child);
  }
  return { dir: node.dir, children: read, sizes: [...sizes] };
}

/** The saved tree when it names every saved pane exactly once, pruned to the panes kept; else undefined. */
function restoreTree(raw: unknown, savedIds: unknown[], kept: string[]): SplitNode | undefined {
  if (raw === undefined) return undefined;
  const leaves: string[] = [];
  const tree = readTree(raw, 0, leaves);
  const unique = new Set(leaves);
  if (!tree || unique.size !== leaves.length || leaves.length !== savedIds.length) return undefined;
  if (!savedIds.every((id) => typeof id === 'string' && unique.has(id))) return undefined;
  return pruneTree(tree, new Set(kept)) ?? undefined;
}

export function restore<R>(raw: unknown, isRoute: (x: unknown) => x is R): Layout<R> | null {
  try {
    const data = raw as { focused: string; tree?: unknown; panes: Array<{ id: string; active: string; tabs: Array<{ id: string; route: unknown }> }> };
    const panes: Pane<R>[] = data.panes
      .map((p): Pane<R> => {
        const tabs: Tab<R>[] = p.tabs
          .filter((t) => typeof t.id === 'string' && isRoute(t.route))
          .map((t) => ({ id: t.id, route: t.route as R, back: [], forward: [] }));
        return { id: p.id, tabs, active: tabs.some((t) => t.id === p.active) ? p.active : tabs[0]?.id ?? '' };
      })
      .filter((p) => typeof p.id === 'string' && p.tabs.length > 0)
      .slice(0, MAX_PANES);
    if (!panes.length) return null;
    const focused = panes.some((p) => p.id === data.focused) ? data.focused : panes[0].id;
    const tree = restoreTree(data.tree, data.panes.map((p) => p.id), panes.map((p) => p.id));
    return tree ? { panes, focused, tree } : { panes, focused };
  } catch {
    return null;
  }
}
