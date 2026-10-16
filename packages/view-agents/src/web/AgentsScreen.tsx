import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorOf, useCommand, useKeybindings } from '@deckbuilderkit/ui';
import { TerminalPane, terminalAppKeys } from '@deckbuilderkit/terminal';
import { agentsCommands } from '../commands';
import { t } from '../i18n';
import { type AgentProject, listAgentProjects, markSeen, removeAgentProject, startSession, terminalOf } from './api';
import { AddProject } from './AddProject';
import { NewSession } from './NewSession';
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

const readHidden = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
};

/** Agents screen: the sessions sidebar and the selected session's terminal. */
export function AgentsScreen() {
  const sessions = useAgentSessions();
  const keys = useKeybindings();
  const [hidden, setHidden] = useState(readHidden);
  const [selectedId, setSelectedId] = useState<string>();
  const [newFor, setNewFor] = useState<string>();
  const [pool, setPool] = useState<Attached[]>([]);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [adding, setAdding] = useState(false);

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

  const select = useCallback(
    async (sessionId: string) => {
      setNewFor(undefined);
      setSelectedId(sessionId);
      setError('');
      void markSeen(sessionId).catch(() => undefined);
      if (pool.some((x) => x.sessionId === sessionId)) {
        setPool((p) => [p.find((x) => x.sessionId === sessionId)!, ...p.filter((x) => x.sessionId !== sessionId)]);
        return;
      }
      const s = sessions.find((x) => x.id === sessionId);
      try {
        const live = await terminalOf(sessionId);
        if (live) return attach({ sessionId, terminal: live });
        if (!s) return;
        const r = await startSession({ account: s.account, dir: s.cwd, sessionId });
        attach({ sessionId, terminal: r.session });
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [pool, sessions, attach],
  );

  // A pane whose session went away (exited) leaves the pool on exit; keep the selection valid.
  useEffect(() => {
    if (selectedId && !sessions.some((s) => s.id === selectedId) && !pool.some((x) => x.sessionId === selectedId)) setSelectedId(undefined);
  }, [sessions, selectedId, pool]);

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
          <h1>{newFor !== undefined ? t('agents.new.title') : (sessions.find((s) => s.id === selectedId)?.title ?? t('agents.heading'))}</h1>
        </header>
        {error && <div role="alert" className="agents-error">{error}</div>}
        {newFor !== undefined && (
          <NewSession
            projects={projects}
            projectId={newFor}
            lastAccount={lastAccount}
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
          {!pool.some((a) => a.sessionId === selectedId) && newFor === undefined && <p className="agents-empty agents-placeholder">{t('agents.pick')}</p>}
        </div>
      </section>
    </div>
  );
}
