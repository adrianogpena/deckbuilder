import { type FSWatcher, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineServerView, socketTickets, validGroup, type SocketData, type SocketRoutes } from '@deckbuilderkit/server-core';
import type { ServerWebSocket } from 'bun';
import { CHAT_SOCKET_PATH, type ChatClientFrame, type ChatServerFrame } from './chat-protocol.ts';
import type { AgentSessionView, AgentsFrame } from './protocol.ts';
import type { AgentsMode, AgentsSettings } from './settings-types.ts';
import { type AgentAccount, detectAccounts } from './server/accounts.ts';
import { CLAUDE_LAUNCHER_ID, claudeLauncher } from './server/launcher.ts';
import { type ChatManager, type ChatSession, type ChatSubscriber, createChatManager } from './server/chat/manager.ts';
import { CHAT_MCP_PATH } from './server/chat/permission-mcp.ts';
import type { SpawnFn } from './server/chat/process.ts';
import { createSessionScanner, matchProject } from './server/discovery.ts';
import { createProjectsStore, type ProjectsStore } from './server/projects.ts';
import { type AgentStatus, createStatusTracker, readPidFiles } from './server/status.ts';

/** The part of the server settings the Agents view owns; the app's `Settings` extends it. */
export interface AgentsServerSettings {
  /** Agents settings, checked by `validAgents`. */
  agents?: AgentsSettings;
}

/** A copy of `raw` when it is a well-formed Agents settings group, else null. */
const AGENTS_MODES: AgentsMode[] = ['terminal', 'chat'];

export const validAgents = (raw: unknown): AgentsSettings | null => validGroup(raw, { mode: AGENTS_MODES }) as AgentsSettings | null;

export const AGENTS_SOCKET_PATH = '/api/agents/socket';
const RESCAN_MS = 10_000;
const DEBOUNCE_MS = 300;

export type { AgentSessionView };

export interface AgentsServerViewOptions {
  /** Home holding the `.claude*` account dirs; defaults to the user's home. */
  home?: string;
  rescanMs?: number;
  /** Chat engine overrides (tests): how the `claude` process is spawned, its command and base environment. */
  chat?: { spawn?: SpawnFn; claudeCmd?: string; env?: Record<string, string | undefined>; idleMs?: number };
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
  let seen: Record<string, number> | undefined;
  let projects: ProjectsStore | undefined;
  let last = { sessions: '', status: '' };

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
    const statuses = tracker.update(accs.flatMap((a) => readPidFiles(a.dir)));
    const s = loadSeen();
    const sessions: AgentSessionView[] = scanner
      .scan(accs.map((a) => ({ id: a.id, dir: a.dir })))
      .map((x) => ({ ...x, status: statuses.get(x.id) ?? 'stopped', project: matchProject(x.cwd, refs)?.id, seenAt: s[x.id] }))
      .filter((x) => x.project !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const status: Record<string, AgentStatus> = {};
    for (const x of sessions) status[x.id] = x.status;
    return { sessions, status };
  };

  const broadcast = (frame: AgentsFrame) => {
    const text = JSON.stringify(frame);
    for (const ws of clients) ws.send(text);
  };

  const refresh = async (force = false) => {
    if (clients.size === 0) return;
    const { sessions, status } = await compute();
    const statusKey = JSON.stringify(status);
    const listKey = JSON.stringify(sessions.map(({ status: _s, ...rest }) => rest));
    if (force || listKey !== last.sessions) {
      last = { sessions: listKey, status: statusKey };
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
      chat = createChatManager({ ...opts.chat, dir: join(ctx.dataDir, 'agents', 'chat'), accounts, baseUrl: () => baseUrl });
      const store = createProjectsStore(join(ctx.dataDir, 'agents', 'projects.json'));
      projects = store;
      return {
        'GET /api/agents/accounts': () => accounts(),
        'GET /api/agents/sessions': async () => (await compute()).sessions,
        'GET /api/agents/projects': () => store.list(),
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
          return { ok: true, sessionId, launch: { id: CLAUDE_LAUNCHER_ID, args: { account: acc.id, sessionId, resume } } };
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
        'POST /api/agents/socket-ticket': () => ({ ticket: tickets.issue(true) }),
        'POST /api/agents/chat/socket-ticket': ({ url }) => {
          if (url) baseUrl = url.origin;
          return { ticket: chatTickets.issue(true) };
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
          void compute().then(({ sessions }) => ws.send(JSON.stringify({ type: 'sessions', sessions } satisfies AgentsFrame)));
        },
        message() {},
        close(ws) {
          clients.delete(ws);
          if (clients.size === 0) stop();
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
      chat?.closeAll();
    },
  });
}
