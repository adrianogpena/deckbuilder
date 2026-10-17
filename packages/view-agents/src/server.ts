import { type FSWatcher, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createToaster } from '@deckbuilderkit/platform';
import { defineServerView, ndjson, socketTickets, validGroup, type SocketData, type SocketRoutes } from '@deckbuilderkit/server-core';
import type { ServerWebSocket } from 'bun';
import { CHAT_SOCKET_PATH, type ChatClientFrame, type ChatServerFrame } from './chat-protocol.ts';
import type { AgentAccountUsage, AgentRunning, AgentSessionView, AgentsCapWarn, AgentsFrame } from './protocol.ts';
import type { AgentsMode, AgentsSettings } from './settings-types.ts';
import { type AgentAccount, detectAccounts } from './server/accounts.ts';
import { createNotifier, NOTIFY_LABEL } from './server/notify.ts';
import { CLAUDE_LAUNCHER_ID, claudeLauncher } from './server/launcher.ts';
import { type ChatManager, type ChatSession, type ChatSubscriber, createChatManager } from './server/chat/manager.ts';
import { findSessionFile, loadHistory } from './server/chat/normalize.ts';
import { CHAT_MCP_PATH } from './server/chat/permission-mcp.ts';
import type { SpawnFn } from './server/chat/process.ts';
import { createSessionScanner, matchProject } from './server/discovery.ts';
import { detectScreenError } from './server/screen-errors.ts';
import { createProjectsStore, type ProjectsStore } from './server/projects.ts';
import { createRunningStore, type RunningRecord, type RunningStore } from './server/running.ts';
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

export const validAgents = (raw: unknown): AgentsSettings | null => validGroup(raw, { mode: AGENTS_MODES, softCap: [1, 100], notifyNeedsYou: 'boolean', notifyDone: 'boolean', notifyError: 'boolean', autoSettle: 'boolean' }) as AgentsSettings | null;

export const AGENTS_SOCKET_PATH = '/api/agents/socket';
const RESCAN_MS = 10_000;
const DEBOUNCE_MS = 300;
const RUNNING_SYNC_MS = 5_000;
const DEFAULT_SOFT_CAP = 12;

export type { AgentSessionView };

export interface AgentsServerViewOptions {
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
  const tickets = socketTickets<true>();
  const chatTickets = socketTickets<true>();
  const chatBindings = new WeakMap<ServerWebSocket<SocketData>, { session?: ChatSession; sub: ChatSubscriber }>();
  let chat: ChatManager | undefined;
  let baseUrl = 'http://127.0.0.1';
  const clients = new Set<ServerWebSocket<SocketData>>();
  let watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
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
  const notifier = createNotifier({
    show: opts.toast ?? ((x) => toaster?.show(x)),
    link: () => opts.link?.(),
    settings: async () => (await loadSettings()).agents,
    shown: () => shownId,
    text: (status, s) => ({ title: `${NOTIFY_LABEL[status]}: ${s.title || s.firstPrompt || s.id}`, body: s.cwd }),
  });

  const liveTerminalIds = () => [...(opts.terminalScreens?.() ?? [])].map(([id]) => id);

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
    const statuses = tracker.update(pids, screenErrors);
    const external = externalIds(pids, [...liveTerminalIds(), ...(chat?.live().ids ?? [])]);
    const s = loadSeen();
    const usage = usageReader.read(accs);
    const views: AgentSessionView[] = scanner
      .scan(accs.map((a) => ({ id: a.id, dir: a.dir })))
      .map((x) => ({ ...x, contextPercent: usageContextPercent(usage.bySession.get(x.id)) ?? x.contextPercent, status: statuses.get(x.id) ?? 'stopped', external: external.has(x.id) || undefined, project: matchProject(x.cwd, refs)?.id, seenAt: s[x.id] }))
      .filter((x) => x.project !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if ((await loadSettings()).agents?.autoSettle !== false) sessionState?.settle(views);
    const sessions = views.map((x) => ({ ...x, ...sessionState?.get(x.id) }));
    const status: Record<string, AgentStatus> = {};
    for (const x of sessions) status[x.id] = x.status;
    void notifier.observe(sessions);
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
  };

  const stop = () => {
    for (const w of watchers) w.close();
    watchers = [];
    clearInterval(timer);
    clearTimeout(debounce);
    timer = undefined;
  };

  return defineServerView<AgentsServerSettings>({
    id: 'agents',
    settings: { validate: { agents: validAgents } },
    routes: (ctx) => {
      seenFile = join(ctx.dataDir, 'agents', 'seen.json');
      usageDir = join(ctx.dataDir, 'agents', 'usage');
      chat = createChatManager({ ...opts.chat, dir: join(ctx.dataDir, 'agents', 'chat'), accounts, baseUrl: () => baseUrl });
      const store = createProjectsStore(join(ctx.dataDir, 'agents', 'projects.json'));
      projects = store;
      const states = createSessionStateStore(join(ctx.dataDir, 'agents', 'session-state.json'));
      sessionState = states;
      loadSettings = () => ctx.settings.load();
      running = createRunningStore(join(ctx.dataDir, 'agents', 'running.json'));
      clearInterval(runningTimer);
      runningTimer = setInterval(() => void syncRunning(), RUNNING_SYNC_MS);
      runningTimer.unref?.();
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
        'POST /api/agents/terminal/prepare': async ({ json }) => {
          const b = await json<{ account?: unknown; sessionId?: unknown }>();
          const acc = accounts().find((a) => a.id === b.account);
          if (!acc) return { ok: false };
          const resume = typeof b.sessionId === 'string' && b.sessionId !== '';
          const sessionId = resume ? (b.sessionId as string) : crypto.randomUUID();
          const warn = await capWarn();
          void syncRunning();
          return { ok: true, sessionId, launch: { id: CLAUDE_LAUNCHER_ID, args: { account: acc.id, sessionId, resume } }, warn };
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
          tracker.markSeen(b.sessionId);
          loadSeen()[b.sessionId] = Date.now();
          saveSeen();
          void refresh(true);
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
      chat?.closeAll();
    },
  });
}
