import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closeSession } from '@deckbuilderkit/terminal/session';
import { addTab, closeTabs, type ContextMenuItem, navigate, newTab, serialize, type Tab, type TabContext, type TabTitle, TabWorkspace, useDebouncedSave, useDialogs } from '@deckbuilderkit/ui';
import { t } from '../../i18n';
import { displayName } from '../attention';
import { EmptyCard } from './EmptyCard';
import { useAgentsHost } from './host';
import { agentTabOf, allTabs, dedupeCopies, EMPTY_KIND, emptyRoute, focusedAgentId, focusTab, openRoute, paramsOf, patchParams, projectPathOf, restoreLayout, routeOf, sameFolder, shellSessions, singleTabOf, type WorkspaceLayout } from './layout-model';
import { getLayout, putLayout } from './layout-api';
import { MissingPanel } from './MissingPanel';
import { PanelBoundary } from './PanelBoundary';
import { capabilities, panelOf, panelsIn } from './registry';
import type { OpenOptions, PanelKind, PanelParams, PanelRoute, WorkspaceApi } from './types';

/** What the screen can do to one project's workspace. */
export interface WorkspaceHandle {
  api: WorkspaceApi;
  /** Shows the session's agent tab (opens it, or focuses the open one); `terminal` hints the pty to attach to, `from` is the id the tab had before. */
  openAgent(sessionId: string, opts?: { terminal?: string; from?: string }): void;
  /** Closes the session's agent tab, if any. */
  closeAgent(sessionId: string): void;
}

export interface ProjectWorkspaceProps {
  /** Folder of the project. */
  project: string;
  /** Another project's workspace is shown; this one stays mounted. */
  hidden: boolean;
  /** Told when the handle is ready (the layout is loaded) and null when the workspace goes. */
  register(project: string, handle: WorkspaceHandle | null): void;
  /** Told, while shown, the Claude session of the workspace's focused agent tab (undefined: none). */
  onFocusedAgent(project: string, sessionId: string | undefined): void;
}

const isSingle = (kind: string) => panelOf(kind)?.single === true;

const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** One project's dock: a TabWorkspace of panel tabs whose layout is loaded from and saved to the server. */
export function ProjectWorkspace({ project, hidden, register, onFocusedAgent }: ProjectWorkspaceProps) {
  const host = useAgentsHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const dialogs = useDialogs();
  const [layout, setLayout] = useState<WorkspaceLayout>();
  const latest = useRef<WorkspaceLayout>();
  const save = useDebouncedSave((next: WorkspaceLayout) => void putLayout(project, serialize(next)).catch(() => undefined), 1000);

  const change = useCallback(
    (raw: WorkspaceLayout) => {
      const prev = latest.current;
      if (prev === raw) return;
      const next = prev ? dedupeCopies(prev, raw, isSingle) : raw;
      latest.current = next;
      setLayout(next);
      save(next);
      if (prev) {
        const kept = shellSessions(next);
        for (const id of shellSessions(prev)) if (!kept.has(id)) void closeSession(id).catch(() => undefined);
      }
    },
    [save],
  );

  useEffect(() => {
    let alive = true;
    const init = (raw: unknown) => {
      if (!alive) return;
      const { sessions, projects } = hostRef.current;
      const live = sessions.filter((s) => s.live && !s.external && sameFolder(projectPathOf(s, projects), project)).map((s) => s.id);
      const next = restoreLayout(raw, live);
      latest.current = next;
      setLayout(next);
    };
    getLayout(project).then((r) => init(r.layout), () => init(null));
    return () => {
      alive = false;
    };
  }, [project]);

  /** Opens `route`: in the lone empty tab if that is all there is, else as a new tab (next to `beside`). */
  const show = useCallback(
    (route: PanelRoute, opts?: OpenOptions, paneTab?: string): string => {
      const cur = latest.current!;
      const tabs = allTabs(cur);
      if (tabs.length === 1 && tabs[0]!.route.kind === EMPTY_KIND) {
        change(focusTab(navigate(cur, tabs[0]!.id, route, { replace: true }), tabs[0]!.id));
        return tabs[0]!.id;
      }
      const r = openRoute(cur, route, opts?.beside ?? paneTab);
      change(r.layout);
      return r.id;
    },
    [change],
  );

  const open = useCallback(
    (kind: PanelKind, params: PanelParams = {}, opts?: OpenOptions): string => {
      const cur = latest.current!;
      if (isSingle(kind)) {
        const existing = singleTabOf(cur, kind);
        if (existing) {
          change(focusTab(patchParams(cur, existing.id, params), existing.id));
          return existing.id;
        }
      }
      return show(routeOf(kind, params), opts);
    },
    [change, show],
  );

  const api = useMemo<WorkspaceApi>(
    () => ({
      open,
      focus: (id) => change(focusTab(latest.current!, id)),
      close: (id) => change(closeTabs(latest.current!, [id], () => newTab(emptyRoute()))),
      moveTo: (id, to) => hostRef.current.moveTo?.(project, id, to),
      sendToSession: (sessionId, textToSend) => hostRef.current.sendToSession(sessionId, textToSend),
      activeProject: project,
    }),
    [open, change, project],
  );

  const handle = useMemo<WorkspaceHandle>(
    () => ({
      api,
      openAgent(sessionId, opts) {
        const cur = latest.current!;
        const hint = opts?.terminal ? { terminal: opts.terminal } : {};
        const old = opts?.from && opts.from !== sessionId ? agentTabOf(cur, opts.from) : undefined;
        if (old) return change(focusTab(patchParams(cur, old.id, { sessionId, ...hint }), old.id));
        const existing = agentTabOf(cur, sessionId);
        if (existing) return change(focusTab(opts?.terminal ? patchParams(cur, existing.id, hint) : cur, existing.id));
        show(routeOf('agent', { sessionId, ...hint }));
      },
      closeAgent(sessionId) {
        const tab = agentTabOf(latest.current!, sessionId);
        if (tab) api.close(tab.id);
      },
    }),
    [api, change, show],
  );

  const ready = layout !== undefined;
  useEffect(() => {
    if (!ready) return;
    register(project, handle);
    return () => register(project, null);
  }, [ready, handle, project, register]);

  const lastAgent = useRef<string>();
  const focusedAgent = layout ? focusedAgentId(layout) : undefined;
  if (focusedAgent) lastAgent.current = focusedAgent;
  else if (lastAgent.current && layout && !agentTabOf(layout, lastAgent.current)) lastAgent.current = undefined;
  const reported = focusedAgent ?? lastAgent.current;
  useEffect(() => {
    if (ready && !hidden) onFocusedAgent(project, reported);
  }, [ready, hidden, reported, project, onFocusedAgent]);

  const patchTab = (tabId: string, patch: PanelParams) => change(patchParams(latest.current!, tabId, patch));

  const rename = async (tab: Tab<PanelRoute>) => {
    const current = text(paramsOf(tab.route).title) ?? '';
    const value = await dialogs.prompt({ title: t('workspace.rename.title'), label: t('workspace.rename.label'), value: current });
    if (value !== null) patchTab(tab.id, { title: value.trim() || undefined });
  };
  const restartShell = (tab: Tab<PanelRoute>) => {
    const gen = typeof paramsOf(tab.route).gen === 'number' ? (paramsOf(tab.route).gen as number) : 0;
    patchTab(tab.id, { session: undefined, gen: gen + 1 });
  };

  const titleOf = (route: PanelRoute): TabTitle => {
    const custom = text(paramsOf(route).title);
    if (route.kind === EMPTY_KIND) return { title: t('workspace.tab.new'), icon: 'plus' };
    if (route.kind === 'agent') {
      const s = host.sessions.find((x) => x.id === paramsOf(route).sessionId);
      return { title: custom ?? (s ? displayName(s) : t('panel.agent.title')), icon: 'cube', tooltip: s?.cwd };
    }
    const mod = panelOf(route.kind);
    if (!mod) return { title: route.kind, icon: 'file' };
    return { title: custom ?? t(mod.titleKey), icon: mod.icon };
  };

  const menuOf = (route: PanelRoute, tab: Tab<PanelRoute>): Array<ContextMenuItem | 'sep'> => {
    const items: ContextMenuItem[] = [];
    if (route.kind === 'terminal') {
      items.push({ id: 'rename', label: t('workspace.tab.rename'), icon: 'edit', run: () => void rename(tab) });
      items.push({ id: 'restart', label: t('workspace.tab.restart'), icon: 'rotate-ccw', run: () => restartShell(tab) });
    }
    if (capabilities.sidebarCards && panelOf(route.kind)?.addMenu === 'tools') {
      items.push({ id: 'toSidebar', label: t('workspace.tab.moveToSidebar'), icon: 'sidebar', run: () => api.moveTo(tab.id, 'sidebar') });
    }
    return items;
  };

  const newMenu = (paneId: string): Array<ContextMenuItem | 'sep'> => {
    const add = (route: PanelRoute) => {
      const cur = latest.current!;
      const only = allTabs(cur);
      if (only.length === 1 && only[0]!.route.kind === EMPTY_KIND) return void show(route);
      const pane = cur.panes.find((p) => p.id === paneId);
      change(addTab(cur, newTab(route), pane ? paneId : undefined));
    };
    const heading = (id: string, label: string): ContextMenuItem => ({ id: `h-${id}`, label, disabled: true, run: () => {} });
    const accounts = host.accounts;
    const agents: ContextMenuItem[] =
      accounts.length > 1
        ? accounts.map((a) => ({ id: `agent:${a.id}`, label: t('workspace.newSession', { account: a.label }), icon: 'cube' as const, hint: a.active ? '✓' : undefined, run: () => host.newSession(project, a.id) }))
        : [{ id: 'agent', label: t('workspace.newSession.noProject'), icon: 'cube', run: () => host.newSession(project, accounts[0]?.id) }];
    return [
      heading('terminal', t('workspace.menu.terminal')),
      { id: 'terminal', label: t('workspace.newTerminal'), icon: 'terminal', run: () => add(routeOf('terminal')) },
      'sep',
      heading('agents', t('workspace.menu.agents')),
      ...agents,
      'sep',
      heading('tools', t('workspace.menu.tools')),
      ...panelsIn('tools').map((m): ContextMenuItem => ({
        id: m.kind,
        label: t(m.titleKey),
        icon: m.icon,
        hint: m.comingSoon ? t('workspace.comingSoon') : undefined,
        run: () => {
          const existing = m.single ? singleTabOf(latest.current!, m.kind) : undefined;
          if (existing) api.focus(existing.id);
          else add(routeOf(m.kind));
        },
      })),
    ];
  };

  const renderTab = (tab: Tab<PanelRoute>, ctx: TabContext<PanelRoute>): ReactNode => {
    const route = tab.route;
    const params = paramsOf(route);
    const mod = panelOf(route.kind);
    let body: ReactNode;
    if (route.kind === EMPTY_KIND) {
      body = (
        <EmptyCard
          onNewSession={() => host.newSession(project)}
          onNewTerminal={() => {
            const id = open('terminal');
            if (id !== tab.id) api.close(tab.id);
          }}
        />
      );
    } else if (mod) {
      const Panel = mod.Panel;
      body = <Panel project={project} params={params} api={api} tabId={tab.id} visible={ctx.visible && !hidden} focused={ctx.focused && !hidden} update={(patch) => patchTab(tab.id, patch)} />;
    } else {
      body = <MissingPanel kind={route.kind} />;
    }
    return <PanelBoundary>{body}</PanelBoundary>;
  };

  return (
    <div className="agents-dock" hidden={hidden}>
      {layout ? (
        <TabWorkspace<PanelRoute> layout={layout} onChange={change} renderTab={renderTab} titleOf={titleOf} menuOf={menuOf} newMenu={newMenu} newRoute={emptyRoute} scope={hidden ? 'agents-hidden' : 'agents'} />
      ) : (
        <p className="agents-dock-loading">{t('workspace.loading')}</p>
      )}
      {dialogs.element}
    </div>
  );
}
