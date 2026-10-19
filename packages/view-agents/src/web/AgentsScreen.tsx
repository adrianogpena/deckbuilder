import { type UsageSettings, usageViewData } from './UsageView';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveKeys, errorOf, setTitleBadge, useDialogs, setViewTitle, useCommand, useKeybindings, useRunCommand, useToast } from '@deckbuilderkit/ui';
import { TerminalPane, terminalAppKeys, type TerminalPaneHandle } from '@deckbuilderkit/terminal';
import { closeSession, listSessions } from '@deckbuilderkit/terminal/session';
import { agentsCommands } from '../commands';
import { t } from '../i18n';
import { lastResponse, patchSessionState, type AgentProject, type AgentRunning, type AgentSessionView, dismissRecovery, listAgentProjects, listRecovery, markSeen, removeAgentProject, reportShown, restartSession, startInBackground, startSession, stopSession, takeOverSession, terminalOf } from './api';
import { AddProject } from './AddProject';
import { AlertsPanel } from './AlertsPanel';
import { UsageTab } from './UsageTab';
import { SkillsPanel } from './SkillsPanel';
import { categoryOf } from './filters';
import { clampWidth, focusMemory, type FocusRegion, PANEL_W, parseWidths, type PaneWidths, regionOf, SIDEBAR_W, WIDTHS_KEY } from './navigation';
import { displayName, needsYouCount, nextWaiting } from './attention';
import { StatusStrip } from './StatusStrip';
import { ExternalPane } from './ExternalPane';
import { NewSession } from './NewSession';
import { activeDirOf } from './AccountPicker';
import { listAccounts, setActiveAccount } from './api';
import { ChangesTab } from './ChangesTab';
import { NotesTab } from './NotesTab';
import { readPanelTab, SidePanel, type SidePanelTab, writePanelTab } from './SidePanel';
import { TrajectoryTab } from './TrajectoryTab';
import { StoppedPane } from './StoppedPane';
import { GroupSummary } from './GroupSummary';
import { EmptyState } from './EmptyState';
import { ExitBar } from './ExitBar';
import { ResumeBar } from './ResumeBar';
import { SessionHead } from './SessionHead';
import { Sidebar } from './Sidebar';
import { useAgentsFeed } from './useAgentSessions';
import '../styles.css';
import './ui.css';
import './chrome.css';
import './islands.css';

const SIDEBAR_KEY = 'deckbuilder.agents.sidebarHidden';
const PANEL_KEY = 'deckbuilder.agents.panelHidden';
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

/** The side panel is hidden unless the user opened it. */
const readPanelHidden = () => {
  try {
    return localStorage.getItem(PANEL_KEY) !== '0';
  } catch {
    return true;
  }
};

/** The session id of an `#agents/<id>` app link, if the hash is one. */
/** The session id (and owner account id, if given) of an `#agents/<id>[/<account id>]` app link. */
const linkedSession = (): { id: string; owner?: string } | undefined => {
  const m = /^#\/?agents\/([\w.-]+)(?:\/([\w.-]+))?\/?$/.exec(window.location.hash);
  return m ? { id: m[1]!, owner: m[2] } : undefined;
};

const readWidths = (): PaneWidths => {
  try {
    return parseWidths(localStorage.getItem(WIDTHS_KEY));
  } catch {
    return parseWidths(null);
  }
};

/**
 * Invisible 8px drag strip between two regions (dashed line, accent on hover or drag). `edge` is the side of the
 * resized region it sits on: 'end' grows the region to its left when dragged right, 'start' the region to its right.
 */
function Sash({ edge, width, onWidth, onDone, onReset }: { edge: 'start' | 'end'; width: () => number; onWidth: (w: number) => void; onDone: () => void; onReset: () => void }) {
  const [dragging, setDragging] = useState(false);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width();
    setDragging(true);
    const move = (ev: PointerEvent) => onWidth(w0 + (edge === 'end' ? ev.clientX - x0 : x0 - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(false);
      onDone();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return <div className={`agents-sash${dragging ? ' dragging' : ''}`} aria-hidden="true" onPointerDown={down} onDoubleClick={onReset} />;
}

/** Agents screen: the sessions sidebar and the selected session's terminal. */
export function AgentsScreen({ usageSettings, dnd = false, onDnd }: { resumeOnSelect?: boolean; usageSettings?: UsageSettings; dnd?: boolean; onDnd?: (on: boolean) => void }) {
  const { sessions, usage, git } = useAgentsFeed();
  const toast = useToast();
  const dialogs = useDialogs();
  const [region, setRegion] = useState<FocusRegion | undefined>(focusMemory.region);
  const onFocusRegion = useCallback((e: { target: EventTarget | null }) => {
    const r = regionOf(e.target instanceof Element ? e.target : null);
    if (!r) return;
    focusMemory.region = r;
    setRegion(r);
  }, []);
  const [widths, setWidths] = useState(readWidths);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const saveWidths = useCallback(() => {
    try {
      localStorage.setItem(WIDTHS_KEY, JSON.stringify(widthsRef.current));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const screenRef = useRef<HTMLDivElement>(null);
  const panelWidth = (key: 'panel' | 'panelWide') => () => {
    const stored = widthsRef.current[key];
    if (stored !== undefined) return stored;
    return screenRef.current?.querySelector<HTMLElement>('.agents-panel')?.offsetWidth ?? PANEL_W.def;
  };
  const keys = useKeybindings();
  const runCommand = useRunCommand();
  const [hidden, setHidden] = useState(readHidden);
  const [panelHidden, setPanelHidden] = useState(readPanelHidden);
  const [panelTab, setPanelTab] = useState<SidePanelTab>(readPanelTab);
  const [selectedId, setSelectedId] = useState<string>();
  const [newFor, setNewFor] = useState<string>();
  /** Project row whose summary fills the main pane; cleared when a session gets selected. */
  const [summaryFor, setSummaryFor] = useState<string>();
  const [visible, setVisible] = useState<AgentSessionView[]>();
  /** Folder row whose summary fills the main pane (exclusive with `summaryFor`). */
  const [folderFor, setFolderFor] = useState<{ id: string; name: string; projectIds: string[] }>();
  useEffect(() => {
    if (selectedId) {
      setSummaryFor(undefined);
      setFolderFor(undefined);
    }
  }, [selectedId]);
  const selectProject = useCallback((projectId: string) => {
    setNewFor(undefined);
    setSelectedId(undefined);
    setFolderFor(undefined);
    setSummaryFor(projectId);
  }, []);
  const selectFolder = useCallback((folder: { id: string; name: string; projectIds: string[] }) => {
    setNewFor(undefined);
    setSelectedId(undefined);
    setSummaryFor(undefined);
    setFolderFor(folder);
  }, []);
  const [pool, setPool] = useState<Attached[]>([]);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [adding, setAdding] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [viewing, setViewing] = useState<string>();
  const [preview, setPreview] = useState<string>();
  /** Sessions the user stopped (exit bar reads "Session stopped") and sessions whose resume bar was dismissed. */
  const [userStopped, setUserStopped] = useState<ReadonlySet<string>>(new Set());
  const [resumeDismissed, setResumeDismissed] = useState<ReadonlySet<string>>(new Set());

  const autoResume = useRef<(items: AgentRunning[]) => Promise<void>>();
  useEffect(() => {
    void listRecovery().then((items) => {
      if (items.length > 0 && items.every((x) => x.auto)) void autoResume.current?.(items);
      else void dismissRecovery().catch(() => undefined);
    }, () => undefined);
  }, []);
  const dismissBanner = useCallback(() => {
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
  const showTrajectory = useCallback(() => {
    setPanelHidden(false);
    try {
      localStorage.setItem(PANEL_KEY, '0');
    } catch {
      /* storage unavailable */
    }
    setPanelTab('trajectory');
    writePanelTab('trajectory');
  }, []);
  useCommand(agentsCommands()[22]!, showTrajectory);

  const waiting = needsYouCount(sessions);
  useEffect(() => {
    setTitleBadge(waiting);
  }, [waiting]);
  useEffect(() => () => setTitleBadge(0), []);

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
      const ext = sessions.find((x) => x.id === sessionId)?.external === true;
      setViewing(ext ? sessionId : undefined);
      setPreview(undefined);
      if (ext) return;
      const stopped = sessions.find((x) => x.id === sessionId);
      if (stopped && categoryOf(stopped) === 'stopped') {
        setPool((p) => p.filter((x) => x.sessionId !== sessionId));
        setPreview(sessionId);
        return;
      }
      if (pool.some((x) => x.sessionId === sessionId)) {
        setPool((p) => [p.find((x) => x.sessionId === sessionId)!, ...p.filter((x) => x.sessionId !== sessionId)]);
        return;
      }
      const s = sessions.find((x) => x.id === sessionId);
      try {
        const live = await terminalOf(sessionId);
        if (live) return attach({ sessionId, terminal: live });
        if (!s) return;
        // Selecting never starts a session: show the stopped-session card, started only by Enter / i / s.
        setPreview(sessionId);
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [pool, sessions, attach],
  );

  const jumpWaiting = useCallback(() => {
    const next = nextWaiting(sessions);
    if (next) void select(next.id);
    else toast({ message: t('agents.noneWaiting') });
  }, [sessions, select, toast]);
  useCommand(agentsCommands()[2]!, jumpWaiting);
  const toggleDnd = useCallback(() => onDnd?.(!dnd), [onDnd, dnd]);
  useCommand(agentsCommands().find((c) => c.id === 'agents.toggleDnd')!, toggleDnd);
  useCommand(agentsCommands()[3]!, () => setAlertsOpen(true));
  useCommand(agentsCommands()[20]!, () => setUsageOpen(true));
  useCommand(agentsCommands()[23]!, () => setSkillsOpen(true));

  const resume = useCallback(
    async (items: AgentRunning[]) => {
      dismissBanner();
      setError('');
      for (const [n, x] of items.entries()) {
        if (n > 0 && x.auto) await new Promise((r) => setTimeout(r, 100));
        if (pool.some((p) => p.sessionId === x.id)) continue;
        try {
          const live = await terminalOf(x.id);
          if (live) attach({ sessionId: x.id, terminal: live });
          else attach({ sessionId: x.id, terminal: (await startSession({ account: x.account, dir: x.cwd, sessionId: x.id })).session });
        } catch (e) {
          setError(errorOf(e).message);
        }
      }
      setSelectedId(items[0]?.id);
    },
    [pool, attach, dismissBanner],
  );
  autoResume.current = resume;

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
      setUserStopped((u) => new Set(u).add(s.id));
      setPool((p) => p.filter((x) => x.sessionId !== s.id));
      if (r.removed) setSelectedId((cur) => (cur === s.id ? undefined : cur));
      else if (selectedId === s.id) {
        setViewing(undefined);
        setPreview(s.id);
      }
    } catch (e) {
      setError(errorOf(e).message);
    }
  }, [selectedId]);

  const restart = useCallback(
    async (s: AgentSessionView) => {
      setNewFor(undefined);
      setError('');
      try {
        const r = await restartSession(s.id);
        setUserStopped((u) => {
          const n = new Set(u);
          n.delete(s.id);
          return n;
        });
        setPool((p) => [{ sessionId: r.sessionId, terminal: r.session }, ...p.filter((x) => x.sessionId !== s.id && x.sessionId !== r.sessionId)].slice(0, POOL_SIZE));
        setSelectedId(r.sessionId);
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [],
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
    if (selectedId && !sessions.some((s) => s.id === selectedId) && !pool.some((x) => x.sessionId === selectedId)) setSelectedId(undefined);
  }, [sessions, selectedId, pool]);

  const selected = sessions.find((s) => s.id === selectedId);
  const summaryProject = summaryFor !== undefined && !selectedId ? projects.find((p) => p.id === summaryFor) : undefined;
  const inExternal = selectedId !== undefined && viewing === selectedId && selected !== undefined;
  const inTerminal = selectedId !== undefined && pool.some((x) => x.sessionId === selectedId);
  const inPreview = selectedId !== undefined && preview === selectedId && !inTerminal && !inExternal;

  const startPreview = async () => {
    const s = sessions.find((x) => x.id === selectedId);
    if (!s) return;
    setError('');
    try {
      const r = await startSession({ account: s.account, dir: s.cwd, sessionId: s.id });
      setPreview(undefined);
      attach({ sessionId: s.id, terminal: r.session });
      void focusSoon();
    } catch (e) {
      setError(errorOf(e).message);
    }
  };

  /** Take over an external session: ends the other terminal's process (after a warning unless it is idle), then resumes it here. */
  const takeOver = async (s: AgentSessionView) => {
    setError('');
    if (s.status !== 'idle' && s.status !== 'done') {
      const status = t(`agents.status.${s.status}`).toLowerCase();
      const ok = await dialogs.confirm({ title: t('agents.external.takeover'), body: t('agents.external.takeoverBusy', { status }), okLabel: t('agents.external.takeover'), danger: true });
      if (!ok) return;
    }
    try {
      if (!(await takeOverSession(s.id)).ok) return setError(t('agents.external.takeoverFailed'));
      setViewing(undefined);
      attach({ sessionId: s.id, terminal: (await startSession({ account: s.account, dir: s.cwd, sessionId: s.id })).session });
      void focusSoon();
    } catch (e) {
      setError(errorOf(e).message);
    }
  };

  /** Clears an exited session: closes its ended terminal so it reads as stopped. */
  const clearExited = async (sessionId: string) => {
    setError('');
    setUserStopped((u) => {
      const n = new Set(u);
      n.delete(sessionId);
      return n;
    });
    try {
      const all = await listSessions();
      for (const x of all) if (x.exited && x.meta?.agentSession === sessionId) await closeSession(x.id);
    } catch (e) {
      setError(errorOf(e).message);
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
  const switchedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!linked) return;
    if (sessions.some((x) => x.id === linked.id)) {
      setLinked(undefined);
      window.history.replaceState(null, '', '#/agents');
      void select(linked.id);
      return;
    }
    // Hidden (showAllSessions off, another owner): make its owner the active account; the feed then lists it and the branch above selects it.
    if (!linked.owner || switchedFor.current === linked.id) return;
    switchedFor.current = linked.id;
    void listAccounts()
      .then((accs) => {
        const owner = accs.find((a) => a.id === linked.owner);
        return owner && !owner.active ? setActiveAccount(activeDirOf(owner)) : undefined;
      })
      .catch(() => undefined);
  }, [linked, sessions, select]);

  // Per session id: how to insert text into its terminal (the Notes tab's Send to session).
  const inserters = useRef(new Map<string, (text: string) => void>());
  const submitters = useRef(new Map<string, (text: string) => void>());
  const sendToSession = useCallback((text: string) => {
    if (selectedId) inserters.current.get(selectedId)?.(text);
  }, [selectedId]);

  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(id);
  }, [notice]);

  const copyResponse = useCallback(async () => {
    if (!selectedId) return setNotice(t('agents.copy.none'));
    try {
      const { text } = await lastResponse(selectedId);
      if (!text) return setNotice(t('agents.copy.none'));
      await navigator.clipboard.writeText(text);
      setNotice(t('agents.copy.done', { n: text.length }));
    } catch (e) {
      setError(errorOf(e).message);
    }
  }, [selectedId]);
  useCommand(agentsCommands()[4]!, () => void copyResponse());

  const clearContext = useCallback(() => {
    const s = sessions.find((x) => x.id === selectedId);
    if (!selectedId || !s) return setNotice(t('agents.clear.noSelection'));
    if (s.external) return setNotice(t('agents.clear.elsewhere'));
    if (!s.live) return setNotice(t('agents.clear.notRunning'));
    if (s.status !== 'idle' && s.status !== 'done' && s.status !== 'error') return setNotice(t('agents.clear.busy'));
    const submit = submitters.current.get(selectedId);
    if (!submit) return setNotice(t('agents.clear.notRunning'));
    submit('/clear');
    setNotice(t('agents.clear.done'));
  }, [sessions, selectedId]);
  useCommand(agentsCommands()[5]!, clearContext);

  const focusInput = useCallback(() => {
    const inputs = document.querySelectorAll<HTMLElement>('.agents-main .xterm-helper-textarea');
    const visible = [...inputs].find((el) => el.offsetParent !== null && !(el as HTMLTextAreaElement).disabled);
    visible?.focus();
    return visible !== undefined && document.activeElement === visible;
  }, []);
  const focusSoon = async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise((res) => setTimeout(res, 50));
      if (focusInput()) return;
    }
  };
  useEffect(() => {
    if (focusMemory.region === 'main') void focusSoon();
    else focusMemory.region ??= 'tree';
  }, []);
  const interact = useCallback(async () => {
    if (!selectedId) return setNotice(t('agents.interact.none'));
    const stopped = selected !== undefined && !selected.external && categoryOf(selected) === 'stopped';
    if (inPreview || stopped) await startPreview();
    for (let i = 0; i < 40; i++) {
      if (focusInput()) return;
      await new Promise((res) => setTimeout(res, 50));
    }
    setNotice(t('agents.interact.none'));
  }, [selectedId, selected, inPreview, startPreview, focusInput]);
  useCommand(agentsCommands()[24]!, () => void interact());
  const newSessionHere = useCallback(() => {
    const project = sessions.find((s) => s.id === selectedId)?.project ?? summaryFor ?? folderFor?.projectIds[0];
    if (!project) return;
    setNewFor(project);
  }, [sessions, selectedId, summaryFor, folderFor]);
  useCommand(agentsCommands()[26]!, newSessionHere);
  useCommand(agentsCommands()[27]!, () => setAdding(true));
  useCommand(agentsCommands()[29]!, () => {
    if (selected && !selected.live && !selected.external) void startPreview();
  });
  useCommand(agentsCommands()[30]!, () => {
    if (selected) void stop(selected);
  });
  useCommand(agentsCommands()[31]!, () => {
    if (selected) void restart(selected);
  });
  useCommand(agentsCommands()[32]!, () => {
    void listAgentProjects().then(setProjects, (e) => setError(errorOf(e).message));
  });
  useCommand(agentsCommands()[48]!, () => void runCommand('app.keybindings'));
  useCommand(agentsCommands()[49]!, () => void runCommand('app.settings'));

  const newKey = useMemo(() => (keys ? effectiveKeys(keys.defs, keys.keymap).get('agents.newSession')?.[0] : undefined), [keys]);
  const showSession = selected !== undefined && newFor === undefined && (inTerminal || inExternal || inPreview);
  const exitedHere = showSession && !inExternal && (selected.lifecycle === 'exited' || (inPreview && (selected.status === 'exited' || userStopped.has(selected.id))));
  const resumeHere = showSession && inPreview && !exitedHere && !selected.external && !resumeDismissed.has(selected.id);
  const projectName = selected ? (projects.find((p) => p.id === selected.project)?.name ?? selected.cwd.split(/[\\/]/).filter(Boolean).pop() ?? selected.cwd) : '';
  const appKeys = useMemo(() => terminalAppKeys('agents', keys?.defs ?? [], ['agents.toggleSidebar', 'agents.togglePanel', 'agents.focusList']), [keys?.defs]);

  // Window title "<project> — <session>" for the selected session; cleared with no selection and on unmount.
  const viewTitle = selected ? `${projectName} — ${displayName(selected)}` : undefined;
  useEffect(() => setViewTitle(viewTitle), [viewTitle]);
  useEffect(() => () => setViewTitle(undefined), []);

  const wide = panelTab === 'trajectory';
  const sizeVars = {
    '--agents-sidebar-w': `${widths.sidebar}px`,
    '--agents-panel-w': `${widths.panel}px`,
    ...(widths.panelWide === undefined ? {} : { '--agents-panel-wide-w': `${widths.panelWide}px` }),
  } as CSSProperties;

  return (
    <div ref={screenRef} className={`view-agents agents-screen${hidden ? ' sidebar-hidden' : ''}${region ? ` focus-${region}` : ''}`} style={sizeVars} onFocusCapture={onFocusRegion}>
      <div className="agents-body">
      {!hidden && <Sidebar
          projects={projects}
          sessions={sessions}
          usage={usage}
          usageSettings={usageSettings}
          onOpenUsage={() => setUsageOpen(true)}
          selectedId={selectedId}
          onSelect={(id) => void select(id)}
          selectedProjectId={summaryFor}
          onSelectProject={selectProject}
          selectedFolderId={folderFor?.id}
          onSelectFolder={selectFolder}
          onVisibleChange={setVisible}
          onNewSession={setNewFor}
          onQuickNew={setNewFor}
          onRemoveProject={removeProject}
          onStop={(s) => void stop(s)}
          onRestart={(s) => void restart(s)}
          onStartBackground={(s) => void startBackground(s)}
        />
      }
      {!hidden && (
        <Sash
          edge="end"
          width={() => widthsRef.current.sidebar}
          onWidth={(w) => setWidths((v) => ({ ...v, sidebar: clampWidth('sidebar', w) }))}
          onDone={saveWidths}
          onReset={() => {
            setWidths((v) => ({ ...v, sidebar: SIDEBAR_W.def }));
            setTimeout(saveWidths);
          }}
        />
      )}
      {alertsOpen && <AlertsPanel projects={projects} onClose={() => setAlertsOpen(false)} />}
      {usageOpen && <UsageTab usage={usage} activeAccount={usageViewData(sessions.find((s) => s.id === selectedId), usage, []).usage?.account} use24h={usageSettings?.use24h} onClose={() => setUsageOpen(false)} />}
      {skillsOpen && <SkillsPanel onClose={() => setSkillsOpen(false)} />}
      {adding && <AddProject added={projects} onAdded={(p) => setProjects((l) => [...l, p])} onClose={() => setAdding(false)} />}
      <section className={`agents-main${region === 'main' ? ' focused' : ''}`}>
        {error && <div role="alert" className="agents-error">{error}</div>}
        {notice && <div role="status" className="agents-notice">{notice}</div>}
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
        {showSession && (
          <SessionHead
            session={selected}
            mode={inExternal ? 'external' : 'terminal'}
            project={projectName}
            git={git[selected.cwd]}
            onRename={(name) => void patchSessionState(selected.id, { name }).catch((e) => setError(errorOf(e).message))}
            onStop={() => void stop(selected)}
            onRestart={() => void restart(selected)}
            onCopy={() => void copyResponse()}
            onTrajectory={() => void runCommand('agents.trajectory')}
            onTogglePanel={() => void runCommand('agents.togglePanel')}
          />
        )}
        <div className="agents-panes" hidden={newFor !== undefined}>
          {pool.map((a) => (
            <div key={a.terminal} className="agents-pane" hidden={a.sessionId !== selectedId}>
              <TerminalPane
                session={a.terminal}
                appKeys={appKeys}
                focused={false}
                handle={(h: TerminalPaneHandle | null) => {
                  if (h) {
                    inserters.current.set(a.sessionId, h.insert);
                    submitters.current.set(a.sessionId, h.submit);
                  } else {
                    inserters.current.delete(a.sessionId);
                    submitters.current.delete(a.sessionId);
                  }
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
                onTakeOver={() => void takeOver(selected)}
              />
            </div>
          )}
          {inPreview && newFor === undefined && selected && (
            <div className="agents-pane">
              <StoppedPane
                session={selected}
                branch={git[selected.cwd]?.branch}
                onStart={() => void startPreview()}
                onBackground={() => void startBackground(selected)}
                onRestart={() => void restart(selected)}
                onClear={() => void clearExited(selected.id)}
                noName
              />
            </div>
          )}
          {summaryProject && !selectedId && newFor === undefined && (
            <div className="agents-pane">
              <GroupSummary
                kind="project"
                name={summaryProject.name}
                path={summaryProject.path}
                sessions={(hidden || !visible ? sessions.filter((s) => !s.archived) : visible).filter((s) => s.project === summaryProject.id)}
                onSelect={(id) => void select(id)}
                onNewSession={() => setNewFor(summaryProject.id)}
              />
            </div>
          )}
          {folderFor && !summaryProject && !selectedId && newFor === undefined && (
            <div className="agents-pane">
              <GroupSummary
                kind="folder"
                name={folderFor.name}
                projectCount={folderFor.projectIds.length}
                sessions={(hidden || !visible ? sessions.filter((s) => !s.archived) : visible).filter((s) => s.project !== undefined && folderFor.projectIds.includes(s.project))}
                onSelect={(id) => void select(id)}
              />
            </div>
          )}
          {!summaryProject && !folderFor && !inTerminal && !inExternal && !inPreview && newFor === undefined && (
            <EmptyState newKey={newKey} onNewSession={projects[0] ? () => setNewFor(projects[0]!.id) : () => setAdding(true)} />
          )}
        </div>
        {exitedHere && <ExitBar code={selected.exitCode} userStopped={userStopped.has(selected.id)} onRestart={() => void restart(selected)} onClose={() => void clearExited(selected.id)} />}
        {resumeHere && <ResumeBar onResume={() => void startPreview()} onDismiss={() => setResumeDismissed((d) => new Set(d).add(selected.id))} />}
      </section>
      {!panelHidden && (
        <Sash
          edge="start"
          width={panelWidth(wide ? 'panelWide' : 'panel')}
          onWidth={(w) => setWidths((v) => ({ ...v, [wide ? 'panelWide' : 'panel']: clampWidth('panel', w) }))}
          onDone={saveWidths}
          onReset={() => {
            setWidths((v) => (wide ? { sidebar: v.sidebar, panel: v.panel } : { ...v, panel: PANEL_W.def }));
            setTimeout(saveWidths);
          }}
        />
      )}
      {!panelHidden && <SidePanel focused={region === 'panel'} onClose={togglePanel} tab={panelTab} onTabChange={setPanelTab} trajectory={<TrajectoryTab sessionId={selected?.id} available={!!selected && selected.lifecycle !== 'starting'} onClose={togglePanel} />} notes={<NotesTab project={selected?.project} canSend={inTerminal && newFor === undefined} onSend={sendToSession} />} changes={<ChangesTab root={projects.find((p) => p.id === selected?.project)?.path ?? selected?.cwd} status={selected?.status} />} />}
      </div>
      <StatusStrip sessions={sessions} dnd={dnd} onJumpWaiting={jumpWaiting} onToggleDnd={toggleDnd} />
    </div>
  );
}
