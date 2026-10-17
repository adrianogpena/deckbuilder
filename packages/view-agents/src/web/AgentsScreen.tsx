import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorOf, setTitleBadge, useCommand, useKeybindings } from '@deckbuilderkit/ui';
import { TerminalPane, terminalAppKeys, type TerminalPaneHandle } from '@deckbuilderkit/terminal';
import { closeSession, listSessions } from '@deckbuilderkit/terminal/session';
import { agentsCommands } from '../commands';
import { t } from '../i18n';
import { type AgentProject, type AgentRunning, type AgentSessionView, dismissRecovery, listAgentProjects, listRecovery, markSeen, removeAgentProject, reportShown, restartSession, startInBackground, startSession, stopChat, stopSession, terminalOf } from './api';
import { AddProject } from './AddProject';
import { AlertsPanel } from './AlertsPanel';
import { displayName, needsYouCount, nextWaiting } from './attention';
import { ChatPane } from './chat/ChatPane';
import { ExternalPane } from './ExternalPane';
import { NewSession } from './NewSession';
import { RecoveryBanner } from './RecoveryBanner';
import { ChangesTab } from './ChangesTab';
import { NotesTab } from './NotesTab';
import { SidePanel } from './SidePanel';
import { StoppedPane } from './StoppedPane';
import { Sidebar } from './Sidebar';
import { useAgentsFeed } from './useAgentSessions';
import '../styles.css';

const SIDEBAR_KEY = 'deckbuilder.agents.sidebarHidden';
const PANEL_KEY = 'deckbuilder.agents.panelHidden';
/** Attached panes kept mounted (hidden) so switching back is instant; older ones detach. */
const POOL_SIZE = 3;

interface Attached {
  sessionId: string;
  terminal: string;
}

/** A mounted chat. `target` is fixed at open (a changing target would reopen the socket); `id` is the session id once known. */
interface ChatEntry {
  key: string;
  target: { sessionId?: string; cwd?: string; accountId?: string };
  id?: string;
}

const entryId = (c: ChatEntry) => c.id ?? c.target.sessionId ?? c.key;

const readHidden = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
};

/** The side panel is hidden unless the user opened it. */
const readPanelHidden = () => {
  try {
    return localStorage.getItem(PANEL_KEY) !== '0';
  } catch {
    return true;
  }
};

/** The session id of an `#agents/<id>` app link, if the hash is one. */
const linkedSession = () => /^#\/?agents\/([\w.-]+)\/?$/.exec(window.location.hash)?.[1];

/** Agents screen: the sessions sidebar and the selected session's terminal. */
export function AgentsScreen({ mode = 'terminal' }: { mode?: 'terminal' | 'chat' }) {
  const { sessions, usage } = useAgentsFeed();
  const keys = useKeybindings();
  const [hidden, setHidden] = useState(readHidden);
  const [panelHidden, setPanelHidden] = useState(readPanelHidden);
  const [selectedId, setSelectedId] = useState<string>();
  const [newFor, setNewFor] = useState<string>();
  const [pool, setPool] = useState<Attached[]>([]);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [adding, setAdding] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [switching, setSwitching] = useState(false);
  const [viewing, setViewing] = useState<string>();
  const [preview, setPreview] = useState<string>();
  const [recovery, setRecovery] = useState<AgentRunning[]>([]);

  useEffect(() => {
    void listRecovery().then(setRecovery, () => undefined);
  }, []);
  const dismissBanner = useCallback(() => {
    setRecovery([]);
    void dismissRecovery().catch(() => undefined);
  }, []);

  useEffect(() => {
    void listAgentProjects().then(setProjects, (e) => setError(errorOf(e).message));
  }, []);
  const removeProject = useCallback((id: string) => {
    void removeAgentProject(id).then(() => setProjects((p) => p.filter((x) => x.id !== id)), (e) => setError(errorOf(e).message));
  }, []);

  const toggleSidebar = useCallback(() => {
    setHidden((h) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, h ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !h;
    });
  }, []);
  useCommand(agentsCommands()[0]!, toggleSidebar);

  const togglePanel = useCallback(() => {
    setPanelHidden((h) => {
      try {
        localStorage.setItem(PANEL_KEY, h ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !h;
    });
  }, []);
  useCommand(agentsCommands()[1]!, togglePanel);

  const waiting = needsYouCount(sessions);
  useEffect(() => {
    setTitleBadge(waiting);
  }, [waiting]);
  useEffect(() => () => setTitleBadge(0), []);

  const lastAccount = useCallback((projectId: string) => sessions.find((s) => s.project === projectId)?.account, [sessions]);

  const attach = useCallback((a: Attached) => {
    setPool((p) => [a, ...p.filter((x) => x.sessionId !== a.sessionId)].slice(0, POOL_SIZE));
  }, []);

  const openChat = useCallback((target: ChatEntry['target']) => {
    const key = `pending-${crypto.randomUUID()}`;
    setChats((c) => [...c, { key, target }]);
    return key;
  }, []);

  const select = useCallback(
    async (sessionId: string) => {
      setNewFor(undefined);
      setSelectedId(sessionId);
      setError('');
      void markSeen(sessionId).catch(() => undefined);
      const ext = sessions.find((x) => x.id === sessionId)?.external === true;
      setViewing(ext ? sessionId : undefined);
      setPreview(undefined);
      if (ext) return;
      if (chats.some((c) => entryId(c) === sessionId)) return;
      if (pool.some((x) => x.sessionId === sessionId)) {
        setPool((p) => [p.find((x) => x.sessionId === sessionId)!, ...p.filter((x) => x.sessionId !== sessionId)]);
        return;
      }
      const s = sessions.find((x) => x.id === sessionId);
      try {
        const live = await terminalOf(sessionId);
        if (live) return attach({ sessionId, terminal: live });
        if (!s) return;
        if (mode === 'chat') {
          openChat({ sessionId });
          return;
        }
        setPreview(sessionId);
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [pool, chats, sessions, attach, mode, openChat],
  );

  const jumpWaiting = useCallback(() => {
    const next = nextWaiting(sessions);
    if (next) void select(next.id);
  }, [sessions, select]);
  useCommand(agentsCommands()[2]!, jumpWaiting);
  useCommand(agentsCommands()[3]!, () => setAlertsOpen(true));

  const resume = useCallback(
    async (items: AgentRunning[]) => {
      dismissBanner();
      setError('');
      for (const x of items) {
        if (chats.some((c) => entryId(c) === x.id) || pool.some((p) => p.sessionId === x.id)) continue;
        try {
          if (x.mode === 'chat') {
            openChat({ sessionId: x.id });
            continue;
          }
          const live = await terminalOf(x.id);
          if (live) attach({ sessionId: x.id, terminal: live });
          else attach({ sessionId: x.id, terminal: (await startSession({ account: x.account, dir: x.cwd, sessionId: x.id })).session });
        } catch (e) {
          setError(errorOf(e).message);
        }
      }
      setSelectedId(items[0]?.id);
    },
    [chats, pool, attach, openChat, dismissBanner],
  );

  // `/clear` gives the pty a new Claude session id (the server adopts it into the pty's meta): follow it in the pool and the selection.
  useEffect(() => {
    if (pool.length === 0) return;
    let alive = true;
    void listSessions().then(
      (all) => {
        const now = new Map(all.map((x) => [x.id, x.meta?.agentSession]));
        const moves = pool.flatMap((a): Array<[string, string]> => {
          const to = now.get(a.terminal);
          return typeof to === 'string' && to !== a.sessionId ? [[a.sessionId, to]] : [];
        });
        if (!alive || moves.length === 0) return;
        setPool((p) => p.map((a) => ({ ...a, sessionId: moves.find((m) => m[0] === a.sessionId)?.[1] ?? a.sessionId })));
        setSelectedId((cur) => moves.find((m) => m[0] === cur)?.[1] ?? cur);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [sessions, pool]);

  const stop = useCallback(async (s: AgentSessionView) => {
    setError('');
    try {
      const r = await stopSession(s.id);
      setPool((p) => p.filter((x) => x.sessionId !== s.id));
      setChats((c) => c.filter((x) => entryId(x) !== s.id));
      if (r.removed) setSelectedId((cur) => (cur === s.id ? undefined : cur));
    } catch (e) {
      setError(errorOf(e).message);
    }
  }, []);

  const restart = useCallback(
    async (s: AgentSessionView) => {
      setNewFor(undefined);
      setError('');
      try {
        if (chats.some((c) => entryId(c) === s.id)) {
          await stopSession(s.id);
          setChats((c) => c.filter((x) => entryId(x) !== s.id));
          openChat({ sessionId: s.id });
          return;
        }
        const r = await restartSession(s.id);
        setPool((p) => [{ sessionId: r.sessionId, terminal: r.session }, ...p.filter((x) => x.sessionId !== s.id && x.sessionId !== r.sessionId)].slice(0, POOL_SIZE));
        setSelectedId(r.sessionId);
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [chats, openChat],
  );

  const startBackground = useCallback(async (s: AgentSessionView) => {
    setError('');
    try {
      await startInBackground({ account: s.account, dir: s.cwd, sessionId: s.id });
    } catch (e) {
      setError(errorOf(e).message);
    }
  }, []);

  // An exited pane stays (screen kept, Exited overlay) until the session is started again; keep the selection valid.
  useEffect(() => {
    if (selectedId && !sessions.some((s) => s.id === selectedId) && !pool.some((x) => x.sessionId === selectedId) && !chats.some((c) => entryId(c) === selectedId)) setSelectedId(undefined);
  }, [sessions, selectedId, pool, chats]);

  const selected = sessions.find((s) => s.id === selectedId);
  const inExternal = selectedId !== undefined && viewing === selectedId && selected !== undefined;
  const inChat = selectedId !== undefined && chats.some((c) => entryId(c) === selectedId);
  const inTerminal = selectedId !== undefined && pool.some((x) => x.sessionId === selectedId);
  const inPreview = selectedId !== undefined && preview === selectedId && !inTerminal && !inChat && !inExternal;

  const startPreview = async () => {
    const s = sessions.find((x) => x.id === selectedId);
    if (!s) return;
    setError('');
    try {
      const r = await startSession({ account: s.account, dir: s.cwd, sessionId: s.id });
      setPreview(undefined);
      attach({ sessionId: s.id, terminal: r.session });
    } catch (e) {
      setError(errorOf(e).message);
    }
  };

  const switchMode = async (to: 'terminal' | 'chat') => {
    if (!selectedId || switching || (to === 'chat' ? inChat : !inChat)) return;
    setSwitching(true);
    setError('');
    try {
      if (to === 'chat') {
        const a = pool.find((x) => x.sessionId === selectedId);
        if (a) {
          await closeSession(a.terminal);
          for (let i = 0; i < 30 && (await terminalOf(selectedId)); i++) await new Promise((res) => setTimeout(res, 100));
        }
        setPool((p) => p.filter((x) => x.sessionId !== selectedId));
        setPreview(undefined);
        openChat({ sessionId: selectedId });
      } else {
        const r = await stopChat(selectedId);
        if (r.busy) return setError(t('agents.mode.busy'));
        setChats((c) => c.filter((x) => entryId(x) !== selectedId));
        setPreview(selectedId);
      }
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setSwitching(false);
    }
  };

  // Tells the server which session is on screen (none while the window is unfocused), so it does not toast for it.
  useEffect(() => {
    const report = () => void reportShown(selectedId && document.hasFocus() && !document.hidden ? selectedId : null).catch(() => undefined);
    report();
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      document.removeEventListener('visibilitychange', report);
      void reportShown(null).catch(() => undefined);
    };
  }, [selectedId]);

  // A toast click opens `#agents/<session id>`: select that session once the list has it.
  const [linked, setLinked] = useState(linkedSession);
  useEffect(() => {
    const onHash = () => setLinked(linkedSession());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!linked || !sessions.some((x) => x.id === linked)) return;
    setLinked(undefined);
    window.history.replaceState(null, '', '#/agents');
    void select(linked);
  }, [linked, sessions, select]);

  // Per session id: how to insert text into its terminal or chat composer (the Notes tab's Send to session).
  const inserters = useRef(new Map<string, (text: string) => void>());
  const sendToSession = useCallback((text: string) => {
    if (selectedId) inserters.current.get(selectedId)?.(text);
  }, [selectedId]);

  const appKeys = useMemo(() => terminalAppKeys('agents', keys?.defs ?? [], ['agents.toggleSidebar', 'agents.togglePanel']), [keys?.defs]);

  return (
    <div className={`view-agents agents-screen${hidden ? ' sidebar-hidden' : ''}`}>
      {!hidden && <Sidebar
          projects={projects}
          sessions={sessions}
          usage={usage}
          selectedId={selectedId}
          onSelect={(id) => void select(id)}
          onNewSession={(p) => setNewFor(p)}
          onAddProject={() => setAdding(true)}
          onRemoveProject={removeProject}
          onStop={(s) => void stop(s)}
          onRestart={(s) => void restart(s)}
          onStartBackground={(s) => void startBackground(s)}
        />
      }
      {alertsOpen && <AlertsPanel projects={projects} onClose={() => setAlertsOpen(false)} />}
      {adding && <AddProject added={projects} onAdded={(p) => setProjects((l) => [...l, p])} onClose={() => setAdding(false)} />}
      <section className="agents-main">
        <header className="agents-main-head">
          <button
            type="button"
            className="agents-toggle"
            aria-pressed={!hidden}
            title={t('keys.agents.toggleSidebar')}
            aria-label={t('keys.agents.toggleSidebar')}
            onClick={toggleSidebar}
          >
            ☰
          </button>
          <h1 className="agents-title">{newFor !== undefined ? t('agents.new.title') : (selected ? displayName(selected) : t('agents.heading'))}</h1>
          {newFor === undefined && (inChat || inTerminal || inPreview) && (
            <div className="agents-mode" role="group" aria-label={t('agents.mode.label')}>
              {(['terminal', 'chat'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={(m === 'chat') === inChat} disabled={switching} onClick={() => void switchMode(m)}>
                  {t(`agents.mode.${m}`)}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="agents-toggle" title={t('agents.alerts.title')} aria-label={t('agents.alerts.title')} onClick={() => setAlertsOpen(true)}>
            🔔
          </button>
          <button
            type="button"
            className="agents-toggle agents-panel-toggle"
            aria-pressed={!panelHidden}
            title={t('keys.agents.togglePanel')}
            aria-label={t('keys.agents.togglePanel')}
            onClick={togglePanel}
          >
            ◫
          </button>
        </header>
        <RecoveryBanner items={recovery} onResume={(i) => void resume(i)} onDismiss={dismissBanner} />
        {error && <div role="alert" className="agents-error">{error}</div>}
        {newFor !== undefined && (
          <NewSession
            projects={projects}
            projectId={newFor}
            lastAccount={lastAccount}
            mode={mode}
            onChat={(r) => {
              setNewFor(undefined);
              setSelectedId(openChat({ cwd: r.cwd, accountId: r.account }));
            }}
            onCancel={() => setNewFor(undefined)}
            onStarted={(r) => {
              setNewFor(undefined);
              setSelectedId(r.sessionId);
              attach({ sessionId: r.sessionId, terminal: r.terminal });
            }}
          />
        )}
        <div className="agents-panes" hidden={newFor !== undefined}>
          {pool.map((a) => (
            <div key={a.terminal} className="agents-pane" hidden={a.sessionId !== selectedId}>
              <TerminalPane
                session={a.terminal}
                appKeys={appKeys}
                focused={a.sessionId === selectedId && newFor === undefined}
                handle={(h: TerminalPaneHandle | null) => {
                  if (h) inserters.current.set(a.sessionId, h.insert);
                  else inserters.current.delete(a.sessionId);
                }}
              />
            </div>
          ))}
          {chats.map((c) => (
            <div key={c.key} className="agents-pane" hidden={entryId(c) !== selectedId || newFor !== undefined}>
              <ChatPane
                {...c.target}
                insertRef={(fn) => {
                  if (fn) inserters.current.set(entryId(c), fn);
                  else inserters.current.delete(entryId(c));
                }}
                onSession={(id) => {
                  setChats((l) => l.map((x) => (x.key === c.key ? { ...x, id } : x)));
                  setSelectedId((cur) => (cur === c.key ? id : cur));
                }}
              />
            </div>
          ))}
          {inExternal && newFor === undefined && selected && (
            <div className="agents-pane">
              <ExternalPane
                sessionId={selected.id}
                updatedAt={selected.updatedAt}
                external={selected.external === true}
                onTakeOver={() => void select(selected.id)}
              />
            </div>
          )}
          {inPreview && newFor === undefined && selected && (
            <div className="agents-pane">
              <StoppedPane sessionId={selected.id} updatedAt={selected.updatedAt} onStart={() => void startPreview()} />
            </div>
          )}
          {!inTerminal && !inChat && !inExternal && !inPreview && newFor === undefined && <p className="agents-empty agents-placeholder">{t('agents.pick')}</p>}
        </div>
      </section>
      {!panelHidden && <SidePanel onClose={togglePanel} notes={<NotesTab project={selected?.project} canSend={(inTerminal || inChat) && newFor === undefined} onSend={sendToSession} />} changes={<ChangesTab root={projects.find((p) => p.id === selected?.project)?.path ?? selected?.cwd} status={selected?.status} />} />}
    </div>
  );
}
