import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorOf, useCommand, useKeybindings } from '@deckbuilderkit/ui';
import { TerminalPane, terminalAppKeys } from '@deckbuilderkit/terminal';
import { closeSession } from '@deckbuilderkit/terminal/session';
import { agentsCommands } from '../commands';
import { t } from '../i18n';
import { type AgentProject, type AgentRunning, dismissRecovery, listAgentProjects, listRecovery, markSeen, removeAgentProject, startSession, stopChat, terminalOf } from './api';
import { AddProject } from './AddProject';
import { ChatPane } from './chat/ChatPane';
import { ExternalPane } from './ExternalPane';
import { NewSession } from './NewSession';
import { RecoveryBanner } from './RecoveryBanner';
import { Sidebar } from './Sidebar';
import { useAgentSessions } from './useAgentSessions';
import '../styles.css';

const SIDEBAR_KEY = 'deckbuilder.agents.sidebarHidden';
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

/** Agents screen: the sessions sidebar and the selected session's terminal. */
export function AgentsScreen({ mode = 'terminal' }: { mode?: 'terminal' | 'chat' }) {
  const sessions = useAgentSessions();
  const keys = useKeybindings();
  const [hidden, setHidden] = useState(readHidden);
  const [selectedId, setSelectedId] = useState<string>();
  const [newFor, setNewFor] = useState<string>();
  const [pool, setPool] = useState<Attached[]>([]);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [adding, setAdding] = useState(false);
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [switching, setSwitching] = useState(false);
  const [viewing, setViewing] = useState<string>();
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
        const r = await startSession({ account: s.account, dir: s.cwd, sessionId });
        attach({ sessionId, terminal: r.session });
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [pool, chats, sessions, attach, mode, openChat],
  );

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

  // A pane whose session went away (exited) leaves the pool on exit; keep the selection valid.
  useEffect(() => {
    if (selectedId && !sessions.some((s) => s.id === selectedId) && !pool.some((x) => x.sessionId === selectedId) && !chats.some((c) => entryId(c) === selectedId)) setSelectedId(undefined);
  }, [sessions, selectedId, pool, chats]);

  const selected = sessions.find((s) => s.id === selectedId);
  const inExternal = selectedId !== undefined && viewing === selectedId && selected !== undefined;
  const inChat = selectedId !== undefined && chats.some((c) => entryId(c) === selectedId);
  const inTerminal = selectedId !== undefined && pool.some((x) => x.sessionId === selectedId);

  const switchMode = async (to: 'terminal' | 'chat') => {
    if (!selectedId || switching || (to === 'chat' ? inChat : inTerminal)) return;
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
        openChat({ sessionId: selectedId });
      } else {
        const r = await stopChat(selectedId);
        if (r.busy) return setError(t('agents.mode.busy'));
        const s = sessions.find((x) => x.id === selectedId);
        if (!s) return;
        const started = await startSession({ account: s.account, dir: s.cwd, sessionId: selectedId });
        setChats((c) => c.filter((x) => entryId(x) !== selectedId));
        attach({ sessionId: selectedId, terminal: started.session });
      }
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setSwitching(false);
    }
  };

  const appKeys = useMemo(() => terminalAppKeys('agents', keys?.defs ?? [], ['agents.toggleSidebar']), [keys?.defs]);

  return (
    <div className={`view-agents agents-screen${hidden ? ' sidebar-hidden' : ''}`}>
      {!hidden && <Sidebar
          projects={projects}
          sessions={sessions}
          selectedId={selectedId}
          onSelect={(id) => void select(id)}
          onNewSession={(p) => setNewFor(p)}
          onAddProject={() => setAdding(true)}
          onRemoveProject={removeProject}
        />
      }
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
          <h1 className="agents-title">{newFor !== undefined ? t('agents.new.title') : (sessions.find((s) => s.id === selectedId)?.title ?? t('agents.heading'))}</h1>
          {newFor === undefined && (inChat || inTerminal) && (
            <div className="agents-mode" role="group" aria-label={t('agents.mode.label')}>
              {(['terminal', 'chat'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={(m === 'chat') === inChat} disabled={switching} onClick={() => void switchMode(m)}>
                  {t(`agents.mode.${m}`)}
                </button>
              ))}
            </div>
          )}
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
                onExit={() => setPool((p) => p.filter((x) => x.terminal !== a.terminal))}
              />
            </div>
          ))}
          {chats.map((c) => (
            <div key={c.key} className="agents-pane" hidden={entryId(c) !== selectedId || newFor !== undefined}>
              <ChatPane
                {...c.target}
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
          {!inTerminal && !inChat && !inExternal && newFor === undefined && <p className="agents-empty agents-placeholder">{t('agents.pick')}</p>}
        </div>
      </section>
    </div>
  );
}
