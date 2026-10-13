import { useEffect, useRef, useState } from 'react';
import { closeSession, listSessions, type SessionInfo, TerminalPane } from '@deckbuilder/terminal';
import {
  addTab,
  ContextMenu,
  type ContextMenuItem,
  Icon,
  type Layout,
  navigate,
  newTab,
  restore,
  serialize,
  singlePane,
  type Tab,
  TabWorkspace,
  useDebouncedSave,
} from '@deckbuilder/ui';
import type { Settings } from '../api';
import { t } from '../i18n';
import './terminal-screen.css';

/** A terminal tab: the session it shows (none: opens one), and the project folder a new one starts in. */
interface Route {
  kind: 'terminal';
  session?: string;
  root?: string;
  path?: string;
}

const optionalString = (v: unknown) => v === undefined || typeof v === 'string';

const isRoute = (x: unknown): x is Route => {
  const r = x as Partial<Route> | null;
  return !!r && typeof r === 'object' && r.kind === 'terminal' && optionalString(r.session) && optionalString(r.root) && optionalString(r.path);
};

const newRoute = (): Route => ({ kind: 'terminal' });

const sessionIds = (layout: Layout<Route>) =>
  new Map(layout.panes.flatMap((p) => p.tabs.filter((x) => x.route.session).map((x) => [x.route.session as string, x.id] as const)));

/**
 * `next` with a fresh shell in every new tab that copies another tab's session (split): two
 * interactive views of one session would take it from each other.
 */
function dropCopiedSessions(prev: Layout<Route>, next: Layout<Route>): Layout<Route> {
  const owners = sessionIds(prev);
  let out = next;
  for (const pane of next.panes) {
    for (const tab of pane.tabs) {
      const owner = tab.route.session && owners.get(tab.route.session);
      if (owner && owner !== tab.id) out = navigate(out, tab.id, { ...tab.route, session: undefined }, { replace: true });
    }
  }
  return out;
}

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

import { generalSettingsOf } from '../settings';
export function TerminalScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [layout, setLayout] = useState<Layout<Route>>(() => restore(settings.terminalLayout, isRoute) ?? singlePane(newTab(newRoute())));
  const latest = useRef(layout);
  latest.current = layout;
  /** Titles the programs set (OSC 0/2), by session id. */
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [infos, setInfos] = useState<Record<string, SessionInfo>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: Array<ContextMenuItem | 'sep'> } | null>(null);
  /** Bell count of each session when the user last saw it in the menu. */
  const seenBells = useRef<Record<string, number>>({});

  const save = useDebouncedSave((next: Layout<Route>) => onSave({ terminalLayout: serialize(next) }));
  const change = (raw: Layout<Route>) => {
    const prev = latest.current;
    const next = dropCopiedSessions(prev, raw);
    latest.current = next;
    setLayout(next);
    save(next);
    const kept = sessionIds(next);
    for (const id of sessionIds(prev).keys()) if (!kept.has(id)) void closeSession(id).catch(() => {});
  };

  const refresh = async () => {
    const list = await listSessions();
    setInfos(Object.fromEntries(list.map((s) => [s.id, s])));
    return list;
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);

  const onSession = (tabId: string, session: string) => {
    const tab = latest.current.panes.flatMap((p) => p.tabs).find((x) => x.id === tabId);
    if (!tab || tab.route.session === session) return;
    // Replace, not push: Back to the route without a session would open another shell.
    change(navigate(latest.current, tabId, { ...tab.route, session }, { replace: true }));
    void refresh().catch(() => {});
  };

  const titleOf = (route: Route) => {
    const info = route.session ? infos[route.session] : undefined;
    const title = (route.session && titles[route.session]) || info?.title;
    if (title) return { title, icon: 'terminal' as const };
    return { title: info ? `${info.label} · ${basename(info.cwd)}` : t('terminalScreen.tab'), tooltip: info?.cwd, icon: 'terminal' as const };
  };

  const openRunning = async (at: { x: number; y: number }) => {
    const list = await refresh().catch(() => [] as SessionInfo[]);
    const shown = sessionIds(latest.current);
    const items: ContextMenuItem[] = list
      .filter((s) => !shown.has(s.id))
      .map((s) => {
        const rang = s.bells > (seenBells.current[s.id] ?? 0);
        return {
          id: s.id,
          label: `${rang ? '● ' : ''}${s.label} · ${basename(s.cwd)}`,
          hint: s.title || undefined,
          icon: 'terminal',
          run: () => {
            seenBells.current[s.id] = s.bells;
            change(addTab(latest.current, newTab<Route>({ kind: 'terminal', session: s.id })));
          },
        };
      });
    setMenu({ ...at, items: items.length ? items : [{ id: 'none', label: t('terminalScreen.sessions.none'), disabled: true, run: () => {} }] });
  };

  return (
    <div className="terminal-screen">
      <div className="terminal-toolbar">
        <button
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            void openRunning({ x: r.left, y: r.bottom });
          }}
        >
          <Icon name="terminal" size={14} /> {t('terminalScreen.sessions')}
        </button>
      </div>
      <TabWorkspace
        confirmCloseDirty={generalSettingsOf(settings).confirmCloseDirty}
        layout={layout}
        onChange={change}
        titleOf={titleOf}
        newRoute={newRoute}
        scope="terminal"
        renderTab={(tab: Tab<Route>) => (
          <TerminalPane
            session={tab.route.session}
            cwd={tab.route.root !== undefined ? { root: tab.route.root, path: tab.route.path ?? '' } : undefined}
            onSession={(id) => onSession(tab.id, id)}
            onTitle={(title) => {
              const session = latest.current.panes.flatMap((p) => p.tabs).find((x) => x.id === tab.id)?.route.session;
              if (session) setTitles((m) => ({ ...m, [session]: title }));
            }}
          />
        )}
      />
      {menu && <ContextMenu at={menu} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
