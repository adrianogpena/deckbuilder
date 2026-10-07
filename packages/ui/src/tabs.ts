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

export interface Layout<R> {
  panes: Pane<R>[];
  focused: string;
}

export const MAX_PANES = 3;
const MAX_HISTORY = 50;

let counter = 0;
export function uid(prefix: string): string {
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
    focused: paneId,
    panes: layout.panes.map((p) => (p.id === paneId ? { ...p, active: tabId } : p)),
  };
}

/** Adds a tab next to the active one in the given pane (focused pane by default) and selects it. */
export function addTab<R>(layout: Layout<R>, tab: Tab<R>, paneId = layout.focused): Layout<R> {
  return {
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
  return { panes, focused };
}

/** Opens a copy of the tab in a new pane to the right (or in the next pane when already at the limit). */
export function splitRight<R>(layout: Layout<R>, tabId: string): Layout<R> {
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
  return { panes, focused: pane.id };
}

/** Moves a tab to another pane (used by drag and drop between tab bars). */
export function moveTab<R>(layout: Layout<R>, tabId: string, toPane: string, index?: number): Layout<R> {
  const tab = findTab(layout, tabId);
  if (!tab) return layout;
  const without = closeTab(layout, tabId, () => tab);
  if (!without.panes.some((p) => p.id === toPane)) return layout;
  return {
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
  };
}

export function restore<R>(raw: unknown, isRoute: (x: unknown) => x is R): Layout<R> | null {
  try {
    const data = raw as { focused: string; panes: Array<{ id: string; active: string; tabs: Array<{ id: string; route: unknown }> }> };
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
    return { panes, focused: panes.some((p) => p.id === data.focused) ? data.focused : panes[0].id };
  } catch {
    return null;
  }
}
