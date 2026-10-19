import { activate, addTab, focusedPane, type Layout, navigate, newTab, openBeside, restore, singlePane, type Tab } from '@deckbuilderkit/ui';
import type { PanelParams, PanelRoute } from './types';

/** Built-in route of a tab with nothing in it: the "New session / New terminal" card. Not a registry kind. */
export const EMPTY_KIND = 'empty';

export type WorkspaceLayout = Layout<PanelRoute>;

export const isRoute = (x: unknown): x is PanelRoute => {
  const r = x as Partial<PanelRoute> | null;
  return !!r && typeof r === 'object' && typeof r.kind === 'string' && r.kind.length > 0 && (r.params === undefined || (typeof r.params === 'object' && r.params !== null && !Array.isArray(r.params)));
};

export const routeOf = (kind: string, params: PanelParams = {}): PanelRoute => ({ kind, params });
export const paramsOf = (route: PanelRoute): PanelParams => route.params ?? {};
export const emptyRoute = (): PanelRoute => routeOf(EMPTY_KIND);

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** The live sessions' agent tabs, else one empty-state tab. */
export function defaultLayout(agentSessionIds: string[]): WorkspaceLayout {
  const routes = agentSessionIds.length > 0 ? agentSessionIds.map((id) => routeOf('agent', { sessionId: id })) : [emptyRoute()];
  const tabs = routes.map((r) => newTab(r));
  const layout = singlePane(tabs[0]!);
  return { ...layout, panes: layout.panes.map((p) => ({ ...p, tabs, active: tabs[0]!.id })) };
}

/** The saved layout when it restores to at least one tab, else the default one. Unknown kinds are kept (they render a "missing panel" card). */
export function restoreLayout(raw: unknown, fallbackSessions: string[]): WorkspaceLayout {
  return (raw ? restore(raw, isRoute) : null) ?? defaultLayout(fallbackSessions);
}

export const allTabs = (layout: WorkspaceLayout): Tab<PanelRoute>[] => layout.panes.flatMap((p) => p.tabs);

export const findTabById = (layout: WorkspaceLayout, id: string): Tab<PanelRoute> | undefined => allTabs(layout).find((x) => x.id === id);

export const agentTabOf = (layout: WorkspaceLayout, sessionId: string): Tab<PanelRoute> | undefined =>
  allTabs(layout).find((x) => x.route.kind === 'agent' && str(paramsOf(x.route).sessionId) === sessionId);

export const singleTabOf = (layout: WorkspaceLayout, kind: string): Tab<PanelRoute> | undefined => allTabs(layout).find((x) => x.route.kind === kind);

/** Shell session ids of the terminal tabs. */
export const shellSessions = (layout: WorkspaceLayout): Set<string> =>
  new Set(allTabs(layout).flatMap((x) => (x.route.kind === 'terminal' ? (str(paramsOf(x.route).session) ?? []) : [])));

/** The Claude session of the focused pane's selected tab, when that tab is an agent tab. */
export function focusedAgentId(layout: WorkspaceLayout): string | undefined {
  const pane = focusedPane(layout);
  const tab = pane.tabs.find((x) => x.id === pane.active) ?? pane.tabs[0];
  return tab?.route.kind === 'agent' ? str(paramsOf(tab.route).sessionId) : undefined;
}

export const paneOfTab = (layout: WorkspaceLayout, tabId: string): string | undefined => layout.panes.find((p) => p.tabs.some((x) => x.id === tabId))?.id;

/** Selects the tab and focuses its pane. */
export function focusTab(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  const pane = paneOfTab(layout, tabId);
  return pane ? activate(layout, pane, tabId) : layout;
}

/** Adds a tab with `route`; `beside` is a tab id to open next to. Returns the new layout and the new tab's id. */
export function openRoute(layout: WorkspaceLayout, route: PanelRoute, beside?: string): { layout: WorkspaceLayout; id: string } {
  const tab = newTab(route);
  const at = beside ? paneOfTab(layout, beside) : undefined;
  if (at) return { layout: openBeside(activate(layout, at, beside!), tab), id: tab.id };
  return { layout: addTab(layout, tab), id: tab.id };
}

/** Merges `patch` into a tab's params in place (no Back entry); an `undefined` value removes the key. */
export function patchParams(layout: WorkspaceLayout, tabId: string, patch: PanelParams): WorkspaceLayout {
  const tab = findTabById(layout, tabId);
  if (!tab) return layout;
  const params = { ...paramsOf(tab.route), ...patch };
  for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
  return navigate(layout, tabId, { ...tab.route, params }, { replace: true });
}

/** The folder of the project a session belongs to: its added project's path, else its own cwd. */
export function projectPathOf(session: { project?: string; cwd: string }, projects: Array<{ id: string; path: string }>): string {
  return (session.project ? projects.find((p) => p.id === session.project)?.path : undefined) ?? session.cwd;
}

/** Same folder, whatever the slash style, trailing slash or case. */
export const sameFolder = (a: string, b: string): boolean => {
  const key = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return key(a) === key(b);
};

/**
 * `next` where the tabs it added that copy a tab of `prev` (a split copies the tab) no longer share its process:
 * a copied shell starts its own, a copied Claude session or `single` tool becomes an empty tab.
 */
export function dedupeCopies(prev: WorkspaceLayout, next: WorkspaceLayout, isSingle: (kind: string) => boolean): WorkspaceLayout {
  const before = allTabs(prev);
  const known = new Set(before.map((x) => x.id));
  const shells = shellSessions(prev);
  const agents = new Set(before.flatMap((x) => (x.route.kind === 'agent' ? (str(paramsOf(x.route).sessionId) ?? []) : [])));
  const singles = new Set(before.map((x) => x.route.kind).filter(isSingle));
  let out = next;
  for (const tab of allTabs(next)) {
    if (known.has(tab.id)) continue;
    const params = paramsOf(tab.route);
    const shell = tab.route.kind === 'terminal' ? str(params.session) : undefined;
    const agent = tab.route.kind === 'agent' ? str(params.sessionId) : undefined;
    if (shell) {
      if (shells.has(shell)) out = navigate(out, tab.id, routeOf('terminal', { ...params, session: undefined }), { replace: true });
      else shells.add(shell);
    } else if (agent) {
      if (agents.has(agent)) out = navigate(out, tab.id, emptyRoute(), { replace: true });
      else agents.add(agent);
    } else if (isSingle(tab.route.kind)) {
      if (singles.has(tab.route.kind)) out = navigate(out, tab.id, emptyRoute(), { replace: true });
      else singles.add(tab.route.kind);
    }
  }
  return out;
}
