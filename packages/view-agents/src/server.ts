import { type FSWatcher, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createToaster } from '@deckbuilderkit/platform';
import { defineServerView, ndjson, socketTickets, validGroup, type SocketData, type SocketRoutes } from '@deckbuilderkit/server-core';
import type { ServerWebSocket } from 'bun';
import { CHAT_SOCKET_PATH, type ChatClientFrame, type ChatServerFrame } from './chat-protocol.ts';
import type { AgentAccountUsage, AgentLaunch, AgentRunning, AgentSessionView, AgentsCapWarn, AgentsFrame, AgentStopResult } from './protocol.ts';
import type { AgentsMode, AgentsSettings } from './settings-types.ts';
import { type AgentAccount, detectAccounts } from './server/accounts.ts';
import { createAlerts } from './server/alerts.ts';
import { createHooks } from './server/hooks.ts';
import { createNotifier, createTransitions, NOTIFY_LABEL } from './server/notify.ts';
import { CLAUDE_LAUNCHER_ID, claudeLauncher } from './server/launcher.ts';
import { claudeCommand } from './server/claude-command.ts';
import { type ChatManager, type ChatSession, type ChatSubscriber, createChatManager } from './server/chat/manager.ts';
import { findSessionFile, loadHistory } from './server/chat/normalize.ts';
import { CHAT_MCP_PATH } from './server/chat/permission-mcp.ts';
import type { SpawnFn } from './server/chat/process.ts';
import { createSessionScanner, matchProject } from './server/discovery.ts';
import { createLifecycle, cwdProblem, planRestart, stopOutcome, type TermInfo } from './server/lifecycle.ts';
import { detectScreenError } from './server/screen-errors.ts';
import { createProjectsStore, type ProjectsStore } from './server/projects.ts';
import { createRunningStore, type RunningRecord, type RunningStore } from './server/running.ts';
import { createNotesStore } from './server/notes.ts';
import { createSessionStateStore, type SessionStateStore } from './server/session-state.ts';
import { searchSessions } from './server/search.ts';
import { createStatuslineInstaller } from './server/statusline-install.ts';
import { type AgentStatus, createStatusTracker, externalIds, readPidFiles } from './server/status.ts';
import { createUsageReader, usageContextPercent } from './server/usage.ts';

/** The part of the server settings the Agents view owns; the app's `Settings` extends it. */
export interface AgentsServerSettings {
  /** Agents settings, checked by `validAgents`. */
  agents?: AgentsSettings;
}

/** A copy of `raw` when it is a well-formed Agents settings group, else null. */
const AGENTS_MODES: AgentsMode[] = ['terminal', 'chat'];

const AGENTS_SPEC = { mode: AGENTS_MODES, softCap: [1, 100], notifyNeedsYou: 'boolean', notifyDone: 'boolean', notifyError: 'boolean', autoSettle: 'boolean', claudeCommand: 'string', 'hooks.onRunning': 'string', 'hooks.onWaiting': 'string', 'hooks.onDone': 'string', 'hooks.onError': 'string' } as const;

/** Validates the group; a valid one is the saved one, so the cached `claude` resolution is refilled from it. */
export const validAgents = (raw: unknown): AgentsSettings | null => {
  const { claudeArgs, ...rest } = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const args = claudeArgs === undefined ? undefined : Array.isArray(claudeArgs) && claudeArgs.length <= 50 && claudeArgs.every((a) => typeof a === 'string' && a.length <= 300) ? (claudeArgs as string[]) : null;
  const group = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && args !== null ? (validGroup(rest, AGENTS_SPEC) as AgentsSettings | null) : null;
  if (!group) return null;
  if (args) group.claudeArgs = args;
  claudeCommand.configure(group);
  return group;
};

export const AGENTS_SOCKET_PATH = '/api/agents/socket';
const RESCAN_MS = 10_000;
const LIFECYCLE_MS = 1_000;
const DEBOUNCE_MS = 300;
const RUNNING_SYNC_MS = 5_000;
const DEFAULT_SOFT_CAP = 12;

export type { AgentSessionView };

/** The part of the terminal sessions store the view drives: list ptys, relink one to another Claude session id, kill one. */
export interface AgentTerminals {
  list(): Array<{ id: string; cwd: string; meta?: Record<string, unknown>; exited: number | null | undefined }>;
  setMeta(id: string, meta: Record<string, unknown> | undefined): void;
  close(id: string): void;
}

export interface AgentsServerViewOptions {
  /** Terminal sessions store: enables Starting/Exited, `/clear` id adoption, stop and restart. */
  terminals?: AgentTerminals;
  /** Home holding the `.claude*` account dirs; defaults to the user's home. */
  home?: string;
  rescanMs?: number;
  /** Last screen lines of the live terminal sessions, by Claude session id (pty `meta.agentSession`); drives the error status. */
  terminalScreens?: () => Iterable<[string, string[]]>;
  /** App link for a path (`StartContext.link`), read when a toast is shown; set by the host once the app started. */
  link?: () => ((path: string) => string) | undefined;
  /** Toast sink (tests); defaults to the Windows toaster. */
  toast?: (toast: { title: string; body: string; launch: string }) => void;
  /** Chat engine overrides (tests): how the `claude` process is spawned, its command and base environment. */
  chat?: { spawn?: SpawnFn; claudeCmd?: string; env?: Record<string, string | undefined>; idleMs?: number };
  /** Statusline installer overrides (tests). */
  statusline?: { execPath?: string; platform?: NodeJS.Platform };
}

export type { AgentsFrame };

/** The `claude` terminal launcher for `terminalServerView({ launchers: launchers({ claude: agentsLauncher() }) })`; same `home` as the view. */
export function agentsLauncher(opts: Pick<AgentsServerViewOptions, 'home'> & { env?: Record<string, string | undefined>; cmd?: string } = {}) {
  const home = opts.home ?? homedir();
  return claudeLauncher({ accounts: () => detectAccounts(home), env: opts.env, cmd: opts.cmd });
}

/** Server half of the Agents view: accounts, sessions with live status, and a socket pushing changes. */
export function agentsServerView(opts: AgentsServerViewOptions = {}) {
  const home = opts.home ?? homedir();
  const scanner = createSessionScanner();
  const tracker = createStatusTracker();
  const life = createLifecycle();
  const tickets = socketTickets<true>();
  const chatTickets = socketTickets<true>();
  const chatBindings = new WeakMap<ServerWebSocket<SocketData>, { session?: ChatSession; sub: ChatSubscriber }>();
  let chat: ChatManager | undefined;
  let baseUrl = 'http://127.0.0.1';
  const clients = new Set<ServerWebSocket<SocketData>>();
  let watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let lifeTimer: ReturnType<typeof setInterval> | undefined;
  let lastLife = '';
  let seenFile = '';
  let usageDir: string | undefined;
  const usageReader = createUsageReader(() => usageDir);
  let seen: Record<string, number> | undefined;
  let projects: ProjectsStore | undefined;
  let sessionState: SessionStateStore | undefined;
  let last = { sessions: '', status: '', usage: '' };
  let running: RunningStore | undefined;
  let runningTimer: ReturnType<typeof setInterval> | undefined;
  let loadSettings: () => Promise<AgentsServerSettings> = async () => ({});
  /** Session the web reports as on screen (Agents view open and focused); no toast for it. */
  let shownId: string | undefined;
  const toaster = opts.toast ? undefined : createToaster();
  const show = opts.toast ?? ((x: { title: string; body: string; launch: string }) => toaster?.show(x));
  const hooks = createHooks({ settings: async () => (await loadSettings()).agents, flash: (message) => show({ title: 'Agents', body: message, launch: '' }) }, createTransitions());
  let alertsDir: string | undefined;
  const alerts = createAlerts(() => alertsDir, createTransitions());
  const notifier = createNotifier({
    show,
    link: () => opts.link?.(),
    settings: async () => (await loadSettings()).agents,
    shown: () => shownId,
    text: (status, s) => ({ title: `${NOTIFY_LABEL[status]}: ${s.title || s.firstPrompt || s.id}`, body: s.cwd }),
  });

  const liveTerminalIds = () => [...(opts.terminalScreens?.() ?? [])].map(([id]) => id);

  /** The Claude ptys of the terminal store (live and exited). */
  const claudeTerms = (): TermInfo[] =>
    (opts.terminals?.list() ?? []).flatMap((s) =>
      typeof s.meta?.agentSession === 'string' ? [{ id: s.id, sessionId: s.meta.agentSession, account: typeof s.meta.account === 'string' ? s.meta.account : undefined, cwd: s.cwd, exited: s.exited }] : [],
    );

  /** One lifecycle step: finds the Starting / Exited sessions and applies `/clear` id changes to the ptys' meta. */
  const lifecycleStep = (pids: ReturnType<typeof readPidFiles>) => {
    const r = life.poll(claudeTerms(), pids);
    for (const a of r.adopt) {
      const cur = opts.terminals?.list().find((x) => x.id === a.terminal);
      if (cur) opts.terminals?.setMeta(a.terminal, { ...cur.meta, agentSession: a.to });
    }
    return r;
  };

  const hasTranscript = (id: string) => accounts().some((a) => findSessionFile(a.dir, id) !== undefined);

  /** The live sessions (terminal ptys and chat processes) with the account and project the scan knows. */
  const liveRecords = async (): Promise<RunningRecord[]> => {
    const { sessions } = await compute();
    const byId = new Map(sessions.map((x) => [x.id, x]));
    const out: RunningRecord[] = [];
    const add = (id: string, mode: RunningRecord['mode']) => {
      const x = byId.get(id);
      if (x && !out.some((r) => r.id === id)) out.push({ id, account: x.account, mode, project: x.project });
    };
    for (const id of liveTerminalIds()) add(id, 'terminal');
    for (const id of chat?.live().ids ?? []) add(id, 'chat');
    return out;
  };
  const syncRunning = () => liveRecords().then((l) => running?.sync(l), () => undefined);

  /** Set when live ptys + chat processes reached the soft cap; the start is never blocked. */
  const capWarn = async (): Promise<AgentsCapWarn | undefined> => {
    const cap = (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents?.softCap ?? DEFAULT_SOFT_CAP;
    const live = liveTerminalIds().length + (chat?.live().count ?? 0);
    return live >= cap ? { live, cap } : undefined;
  };

  const loadSeen = () => {
    if (seen) return seen;
    try {
      seen = JSON.parse(readFileSync(seenFile, 'utf8')) as Record<string, number>;
    } catch {
      seen = {};
    }
    return seen;
  };
  const saveSeen = () => {
    try {
      mkdirSync(join(seenFile, '..'), { recursive: true });
      writeFileSync(seenFile, JSON.stringify(seen ?? {}));
    } catch {
      /* best effort */
    }
  };

  /** Stores the exact stamp of the session's current done / error as its seen mark (skipped when equal). */
  const acknowledge = (id: string) => {
    const stamp = tracker.stamp(id);
    if (stamp === undefined || loadSeen()[id] === stamp) return;
    loadSeen()[id] = stamp;
    saveSeen();
  };

  const accounts = (): AgentAccount[] => detectAccounts(home);

  const compute = async () => {
    const accs = accounts();
    const refs = projects?.list() ?? [];
    const screenErrors = new Map<string, string>();
    for (const [id, lines] of opts.terminalScreens?.() ?? []) {
      const err = detectScreenError(lines);
      if (err) screenErrors.set(id, err.message);
    }
    const pids = accs.flatMap((a) => readPidFiles(a.dir));
    const lc = lifecycleStep(pids);
    const s = loadSeen();
    const statuses = tracker.update(pids, screenErrors, { seen: s, starting: lc.starting, exited: lc.exited.keys() });
    const statusOf = (id: string): AgentStatus => statuses.get(id) ?? tracker.offline(id, s);
    const external = externalIds(pids, [...liveTerminalIds(), ...(chat?.live().ids ?? [])]);
    const usage = usageReader.read(accs);
    const views: AgentSessionView[] = scanner
      .scan(accs.map((a) => ({ id: a.id, dir: a.dir })))
      .map((x) => ({ ...x, lifecycle: lc.exited.has(x.id) ? ('exited' as const) : lc.starting.has(x.id) ? ('starting' as const) : undefined, exitCode: lc.exited.get(x.id), contextPercent: usageContextPercent(usage.bySession.get(x.id)) ?? x.contextPercent, status: statusOf(x.id), live: statuses.has(x.id) || undefined, external: external.has(x.id) || undefined, project: matchProject(x.cwd, refs)?.id, seenAt: s[x.id] }))
      .filter((x) => x.project !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if ((await loadSettings()).agents?.autoSettle !== false) sessionState?.settle(views);
    // A pty whose session has no transcript yet (new, or after `/clear`): listed with the empty title until the first message.
    const scanned = new Set(views.map((x) => x.id));
    for (const term of claudeTerms()) {
      if (scanned.has(term.sessionId) || !term.account) continue;
      scanned.add(term.sessionId);
      const project = matchProject(term.cwd, refs)?.id;
      if (project === undefined) continue;
      const lifecycle = lc.exited.has(term.sessionId) ? ('exited' as const) : lc.starting.has(term.sessionId) ? ('starting' as const) : undefined;
      views.push({ id: term.sessionId, account: term.account, cwd: term.cwd, title: '', firstPrompt: '', updatedAt: Date.now(), status: statusOf(term.sessionId), live: statuses.has(term.sessionId) || undefined, project, lifecycle, exitCode: lc.exited.get(term.sessionId), seenAt: s[term.sessionId] });
    }
    const sessions = views.map((x) => ({ ...x, ...sessionState?.get(x.id) }));
    const status: Record<string, AgentStatus> = {};
    for (const x of sessions) status[x.id] = x.status;
    void hooks.observe(sessions);
    void notifier.observe(sessions);
    alerts.observe(sessions);
    return { sessions, status, usage: usage.accounts as AgentAccountUsage[] };
  };

  const broadcast = (frame: AgentsFrame) => {
    const text = JSON.stringify(frame);
    for (const ws of clients) ws.send(text);
  };

  const refresh = async (force = false) => {
    if (clients.size === 0) return;
    const { sessions, status, usage } = await compute();
    const usageKey = JSON.stringify(usage);
    if (force || usageKey !== last.usage) {
      last.usage = usageKey;
      broadcast({ type: 'usage', accounts: usage });
    }
    const statusKey = JSON.stringify(status);
    const listKey = JSON.stringify(sessions.map(({ status: _s, ...rest }) => rest));
    if (force || listKey !== last.sessions) {
      last = { ...last, sessions: listKey, status: statusKey };
      broadcast({ type: 'sessions', sessions });
    } else if (statusKey !== last.status) {
      last.status = statusKey;
      broadcast({ type: 'status', status });
    }
  };

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void refresh(), DEBOUNCE_MS);
  };

  const start = () => {
    if (timer) return;
    for (const a of accounts()) {
      for (const sub of ['projects', 'sessions']) {
        try {
          watchers.push(watch(join(a.dir, sub), { recursive: true }, schedule));
        } catch {
          /* dir missing or unwatchable: the rescan covers it */
        }
      }
    }
    timer = setInterval(() => void refresh(), opts.rescanMs ?? RESCAN_MS);
    if (opts.terminals) lifeTimer = setInterval(tick, LIFECYCLE_MS);
  };

  /** Every second: follows `/clear` (id adoption) and Starting / Exited; a change pushes a sessions frame. */
  const tick = () => {
    const r = lifecycleStep(accounts().flatMap((a) => readPidFiles(a.dir)));
    const key = JSON.stringify([[...r.starting], [...r.exited], claudeTerms().map((x) => x.sessionId)]);
    if (r.adopt.length === 0 && key === lastLife) return;
    lastLife = key;
    void refresh(true);
  };

  const stop = () => {
    for (const w of watchers) w.close();
    watchers = [];
    clearInterval(timer);
    clearTimeout(debounce);
    clearInterval(lifeTimer);
    lifeTimer = undefined;
    timer = undefined;
  };

  return defineServerView<AgentsServerSettings>({
    id: 'agents',
    settings: { validate: { agents: validAgents } },
    routes: (ctx) => {
      seenFile = join(ctx.dataDir, 'agents', 'seen.json');
      alertsDir = join(ctx.dataDir, 'agents', 'alerts');
      usageDir = join(ctx.dataDir, 'agents', 'usage');
      chat = createChatManager({ ...opts.chat, dir: join(ctx.dataDir, 'agents', 'chat'), accounts, baseUrl: () => baseUrl });
      const store = createProjectsStore(join(ctx.dataDir, 'agents', 'projects.json'));
      projects = store;
      const states = createSessionStateStore(join(ctx.dataDir, 'agents', 'session-state.json'));
      sessionState = states;
      const notes = createNotesStore(join(ctx.dataDir, 'agents', 'notes'));
      loadSettings = () => ctx.settings.load();
      void loadSettings().then((s) => claudeCommand.configure(s.agents), () => {});
      running = createRunningStore(join(ctx.dataDir, 'agents', 'running.json'));
      clearInterval(runningTimer);
      runningTimer = setInterval(() => void syncRunning(), RUNNING_SYNC_MS);
      runningTimer.unref?.();
      const killTerminals = (sessionId: string) => {
        for (const x of claudeTerms()) if (x.sessionId === sessionId) opts.terminals?.close(x.id);
      };
      const launchOf = async (account: string, sessionId: string | undefined): Promise<AgentLaunch> => {
        const resume = sessionId !== undefined;
        const id = sessionId ?? crypto.randomUUID();
        const warn = await capWarn();
        void syncRunning();
        return { ok: true, sessionId: id, launch: { id: CLAUDE_LAUNCHER_ID, args: { account, sessionId: id, resume } }, warn };
      };
      const statusline = createStatuslineInstaller({ agentsDir: join(ctx.dataDir, 'agents'), ...opts.statusline });
      statusline.refresh();
      return {
        'GET /api/agents/accounts': () => accounts(),
        // Usage statusLine per account (Settings): install state, install (backup + chain the previous), uninstall (restore it).
        'GET /api/agents/statusline': () => statusline.statuses(accounts()),
        'POST /api/agents/statusline/install': async ({ json }) => {
          const b = await json<{ account?: unknown }>();
          const acc = accounts().find((a) => a.id === b.account);
          return acc ? statusline.install(acc) : { ok: false, error: 'unknownAccount' };
        },
        'POST /api/agents/statusline/uninstall': async ({ json }) => {
          const b = await json<{ account?: unknown }>();
          const acc = accounts().find((a) => a.id === b.account);
          return acc ? statusline.uninstall(acc) : { ok: false, error: 'unknownAccount' };
        },
        'GET /api/agents/alerts': () => alerts.list(),
        'GET /api/agents/sessions': async () => (await compute()).sessions,
        'GET /api/agents/projects': () => store.list(),
        // Pin / rename / archive one session (no path params in the router, so the id is in the body); '' or null clears the name.
        'PATCH /api/agents/session-state': async ({ json }) => {
          const b = await json<{ id?: unknown; pinned?: unknown; name?: unknown; archived?: unknown }>();
          if (typeof b.id !== 'string' || !b.id) return { ok: false };
          states.set(b.id, b);
          await refresh(true);
          return { ok: true };
        },
        // Per-project markdown notes (the id is in the query / body: no path params).
        'GET /api/agents/notes': ({ query }) => ({ text: notes.read(query.get('project') ?? '') }),
        'PUT /api/agents/notes': async ({ json }) => {
          const b = await json<{ project?: unknown; text?: unknown }>();
          if (typeof b.project !== 'string' || typeof b.text !== 'string') return { ok: false };
          return { ok: notes.write(b.project, b.text) };
        },
        // Full-text search of prompts and assistant text in the added projects' sessions: ndjson of {sessionId, snippet}.
        'GET /api/agents/search': async ({ req, query }) => {
          const q = query.get('q') ?? '';
          const accs = accounts();
          const files: Array<{ id: string; file: string }> = [];
          for (const x of (await compute()).sessions) {
            const dir = accs.find((a) => a.id === x.account)?.dir;
            const file = dir ? findSessionFile(dir, x.id) : undefined;
            if (file) files.push({ id: x.id, file });
          }
          return ndjson(req, (emit, signal) => searchSessions(files, q, emit, signal));
        },
        // Read-only transcript of a session (external sessions open it instead of a terminal or chat).
        'GET /api/agents/history': ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (file) return { events: loadHistory(file) };
          }
          return { events: [] };
        },
        'GET /api/agents/recovery': async () => {
          const { sessions } = await compute();
          const byId = new Map(sessions.map((x) => [x.id, x]));
          const live = [...liveTerminalIds(), ...(chat?.live().ids ?? [])];
          return (running?.recovery(live) ?? []).flatMap((r): AgentRunning[] => {
            const x = byId.get(r.id);
            return x ? [{ ...r, project: x.project, title: x.title, cwd: x.cwd }] : [];
          });
        },
        'GET /api/agents/cap': async () => ({ warn: await capWarn() }),
        'POST /api/agents/recovery/dismiss': () => {
          running?.dismiss();
          return { ok: true };
        },
        'POST /api/agents/projects': async ({ json }) => {
          const p = store.add(await json<{ name?: unknown; path?: unknown }>());
          if (p) void refresh(true);
          return p ? { ok: true, project: p } : { ok: false };
        },
        'DELETE /api/agents/projects': ({ url }) => {
          const ok = store.remove(url?.searchParams.get('id') ?? '');
          if (ok) void refresh(true);
          return { ok };
        },
        // Terminal mode: returns the launcher args for `POST /api/terminal/open`. A new session gets its id here
        // (`--session-id`), so the pty is linked to it from the start through `meta.agentSession`.
        // `dir` (the cwd the pty will start in) is checked: a missing folder starts nothing.
        'POST /api/agents/terminal/prepare': async ({ json }): Promise<AgentLaunch> => {
          const b = await json<{ account?: unknown; sessionId?: unknown; dir?: unknown }>();
          if (typeof b.dir === 'string' && b.dir) {
            const bad = cwdProblem(b.dir);
            if (bad) return { ok: false, ...bad };
          }
          const acc = accounts().find((a) => a.id === b.account);
          if (!acc) return { ok: false, error: 'unknownAccount' };
          return launchOf(acc.id, typeof b.sessionId === 'string' && b.sessionId !== '' ? b.sessionId : undefined);
        },
        // Stop: acknowledges done / error, kills the agent; `removed` when nothing was ever sent (no transcript).
        'POST /api/agents/session/stop': async ({ json }): Promise<AgentStopResult> => {
          const b = await json<{ sessionId?: unknown }>();
          if (typeof b.sessionId !== 'string' || !b.sessionId) return { ok: false, error: 'unknownSession' };
          acknowledge(b.sessionId);
          const r = chat?.stop(b.sessionId) ?? 'none';
          if (r === 'busy') return { ok: false, error: 'busy' };
          killTerminals(b.sessionId);
          void refresh(true);
          return { ok: true, ...stopOutcome(hasTranscript(b.sessionId)) };
        },
        // Restart: ends the old process and returns the launch of a new run (a fresh id when there is no transcript to resume).
        'POST /api/agents/session/restart': async ({ json }): Promise<AgentLaunch> => {
          const b = await json<{ sessionId?: unknown }>();
          const id = typeof b.sessionId === 'string' ? b.sessionId : '';
          const found = (await compute()).sessions.find((x) => x.id === id);
          const plan = planRestart({ known: !!found, external: found?.external === true, sessionId: id, hasTranscript: hasTranscript(id) });
          if (!plan.ok || !found) return { ok: false, error: plan.ok ? 'unknownSession' : plan.error };
          const bad = cwdProblem(found.cwd);
          if (bad) return { ok: false, ...bad };
          killTerminals(id);
          return { ...(await launchOf(found.account, plan.resume ? plan.sessionId : undefined)), cwd: found.cwd };
        },
        // Mode switch to Terminal: stops the session's chat process; `busy` while a turn is running.
        'POST /api/agents/chat/stop': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          if (typeof b.sessionId !== 'string' || !b.sessionId) return { ok: false, busy: false };
          const r = chat?.stop(b.sessionId) ?? 'none';
          return { ok: r !== 'busy', busy: r === 'busy' };
        },
        'POST /api/agents/seen': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          if (typeof b.sessionId !== 'string' || !b.sessionId) return { ok: false };
          acknowledge(b.sessionId);
          await refresh(true);
          return { ok: true };
        },
        // Mark unread: done / error clear the seen mark; no status writes a fresh done; running / waiting do nothing.
        'POST /api/agents/unread': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          if (typeof b.sessionId !== 'string' || !b.sessionId) return { ok: false };
          const id = b.sessionId;
          const st = (await compute()).status[id];
          if (st === 'running' || st === 'needs-you' || st === 'starting') return { ok: true };
          if (tracker.stamp(id) === undefined) tracker.forceDone(id);
          else if (loadSeen()[id] !== undefined) {
            delete loadSeen()[id];
            saveSeen();
          }
          await refresh(true);
          return { ok: true };
        },
        // The web reports which session is on screen (null when the Agents view is hidden or the window unfocused).
        'POST /api/agents/shown': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          shownId = typeof b.sessionId === 'string' && b.sessionId ? b.sessionId : undefined;
          return { ok: true };
        },
        'POST /api/agents/socket-ticket': () => ({ ticket: tickets.issue(true) }),
        'POST /api/agents/chat/socket-ticket': async ({ url }) => {
          if (url) baseUrl = url.origin;
          return { ticket: chatTickets.issue(true), warn: await capWarn() };
        },
      };
    },
    // The CLI's permission prompt tool calls back here; the per-chat token in the path is its credential.
    unauthenticated: () => ({
      [`POST ${CHAT_MCP_PATH}*`]: async ({ url, json }) => {
        const res = await chat?.mcp(url.pathname.slice(CHAT_MCP_PATH.length), await json());
        return res ?? new Response('Not ready', { status: 503 });
      },
      [`GET ${CHAT_MCP_PATH}*`]: () => new Response(null, { status: 405 }),
    }),
    sockets: (): SocketRoutes => ({
      [AGENTS_SOCKET_PATH]: {
        tickets,
        open(ws) {
          clients.add(ws);
          start();
          void compute().then(({ sessions, usage }) => {
            ws.send(JSON.stringify({ type: 'sessions', sessions } satisfies AgentsFrame));
            ws.send(JSON.stringify({ type: 'usage', accounts: usage } satisfies AgentsFrame));
          });
        },
        message() {},
        close(ws) {
          clients.delete(ws);
          if (clients.size === 0) {
            shownId = undefined;
            stop();
          }
        },
      },
      [CHAT_SOCKET_PATH]: {
        tickets: chatTickets,
        open(ws) {
          const sub: ChatSubscriber = { send: (f: ChatServerFrame) => ws.send(JSON.stringify(f)) };
          chatBindings.set(ws, { sub });
        },
        message(ws, msg) {
          const bound = chatBindings.get(ws);
          const sendError = (code: string, message: string) => bound?.sub.send({ type: 'error', code, message });
          if (!bound || !chat || typeof msg !== 'string') return void sendError('badFrame', 'Expected a JSON text frame.');
          let frame: ChatClientFrame;
          try {
            frame = JSON.parse(msg) as ChatClientFrame;
          } catch {
            return void sendError('badFrame', 'Invalid JSON.');
          }
          if (frame?.type === 'open') {
            if (bound.session) return void sendError('alreadyOpen', 'This socket already has a chat.');
            const r = chat.open(frame);
            if ('error' in r) return void sendError(r.error.code, r.error.message);
            bound.session = r.session;
            r.session.subscribe(bound.sub);
          } else if (!bound.session) sendError('notOpen', 'Send an open frame first.');
          else {
            const bad = chat.handle(bound.session, frame);
            if (bad) sendError(bad, 'Unknown frame.');
          }
        },
        close(ws) {
          const bound = chatBindings.get(ws);
          chatBindings.delete(ws);
          bound?.session?.unsubscribe(bound.sub);
        },
      },
    }),
    onQuit() {
      stop();
      clearInterval(runningTimer);
      clearInterval(lifeTimer);
      chat?.closeAll();
    },
  });
}
