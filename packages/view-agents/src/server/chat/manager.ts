import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ChatClientFrame,
  ChatEvent,
  ChatOpenFrame,
  ChatRunState,
  ChatServerFrame,
  ChatState,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  QueuedMessage,
} from '../../chat-protocol.ts';
import { PERMISSION_MODES } from '../../chat-protocol.ts';
import type { AgentAccount } from '../accounts.ts';
import { findSessionFile, loadHistory, normalizeLine, sessionCwd } from './normalize.ts';
import { CHAT_MCP_PATH, handleMcpHttp, type PermissionAsk, type PermissionVerdict, permissionMcpConfig } from './permission-mcp.ts';
import { bunSpawn, buildChatArgs, ChatProcess, claudeEnv, defaultClaudeCommand, type SpawnFn } from './process.ts';

export interface ChatSubscriber {
  send(frame: ChatServerFrame): void;
}

export interface ChatManagerOptions {
  /** Where the per-chat `--mcp-config` files go (`<dataDir>/agents/chat`). */
  dir: string;
  accounts(): AgentAccount[];
  /** Origin the CLI reaches the deckbuilder server on, e.g. `http://127.0.0.1:5173`. */
  baseUrl(): string;
  spawn?: SpawnFn;
  claudeCmd?: string;
  env?: Record<string, string | undefined>;
  /** An idle chat nobody watches is stopped after this long (default 10 min). */
  idleMs?: number;
  /** How long an interrupt waits for the CLI to acknowledge before the process is killed (default 3 s). */
  interruptMs?: number;
}

type Config = Required<Pick<ChatManagerOptions, 'dir' | 'accounts' | 'baseUrl'>> &
  Pick<ChatManagerOptions, 'spawn' | 'claudeCmd' | 'env' | 'idleMs' | 'interruptMs'>;

/** "Always" granularity: the tool, and for Bash its first command word. */
export function permissionKey(a: Pick<PermissionAsk, 'toolName' | 'input'>): string {
  const cmd = (a.input as { command?: unknown } | null)?.command;
  if (a.toolName === 'Bash' && typeof cmd === 'string') return `Bash:${cmd.trim().split(/\s+/)[0] ?? ''}`;
  return a.toolName;
}

const allow = (a: PermissionAsk): PermissionVerdict => ({ behavior: 'allow', updatedInput: a.input });
const deny: PermissionVerdict = { behavior: 'deny', message: 'Denied by the user.' };

/** One chat: its `claude` process, queued follow-ups, pending permission prompts and the sockets watching it. */
export class ChatSession {
  sessionId?: string;
  run: ChatRunState = 'idle';
  queue: QueuedMessage[] = [];
  readonly token = randomBytes(16).toString('hex');
  private perms = new Map<string, { req: PermissionRequest; resolve(v: PermissionVerdict): void }>();
  private always = new Set<string>();
  private subs = new Set<ChatSubscriber>();
  private proc?: ChatProcess;
  private stale = false;
  private initSeen = false;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private cfg: Config,
    private owner: { register(s: ChatSession): void; release(s: ChatSession): void },
    readonly cwd: string,
    readonly account: AgentAccount,
    public mode: PermissionMode,
    readonly model: string | undefined,
    sessionId?: string,
  ) {
    this.sessionId = sessionId;
  }

  private state(): ChatState {
    return {
      run: this.run,
      queue: this.queue,
      permissions: [...this.perms.values()].map((p) => p.req),
      permissionMode: this.mode,
      always: [...this.always],
    };
  }

  private broadcast(frame: ChatServerFrame) {
    for (const s of this.subs) s.send(frame);
  }
  private pushState() {
    this.broadcast({ type: 'state', ...this.state() });
  }
  private emit(event: ChatEvent) {
    this.broadcast({ type: 'event', event });
  }

  subscribe(sub: ChatSubscriber) {
    clearTimeout(this.idleTimer);
    this.subs.add(sub);
    sub.send({ type: 'opened', sessionId: this.sessionId, cwd: this.cwd, accountId: this.account.id, model: this.model });
    const file = this.sessionId ? findSessionFile(this.account.dir, this.sessionId) : undefined;
    sub.send({ type: 'history', events: file ? loadHistory(file) : [] });
    sub.send({ type: 'state', ...this.state() });
  }

  unsubscribe(sub: ChatSubscriber) {
    this.subs.delete(sub);
    this.maybeIdle();
  }

  private maybeIdle() {
    if (this.subs.size > 0 || this.run === 'closed') return;
    if (this.run === 'idle' && !this.proc) return void this.close();
    clearTimeout(this.idleTimer);
    if (this.run === 'idle') this.idleTimer = setTimeout(() => this.close(), this.cfg.idleMs ?? 600_000);
  }

  send(text: string) {
    if (this.run === 'closed' || !text.trim()) return;
    if (this.run === 'running') {
      this.queue.push({ id: randomUUID(), text });
      this.pushState();
    } else this.startTurn(text);
  }

  editQueued(id: string, text: string) {
    const q = this.queue.find((m) => m.id === id);
    if (!q || !text.trim()) return;
    q.text = text;
    this.pushState();
  }

  removeQueued(id: string) {
    this.queue = this.queue.filter((m) => m.id !== id);
    this.pushState();
  }

  setMode(mode: PermissionMode) {
    if (!PERMISSION_MODES.includes(mode) || mode === this.mode) return;
    this.mode = mode;
    this.stale = true;
    this.pushState();
  }

  answer(requestId: string, decision: PermissionDecision) {
    const p = this.perms.get(requestId);
    if (!p) return;
    this.perms.delete(requestId);
    if (decision === 'always') this.always.add(permissionKey(p.req));
    p.resolve(decision === 'deny' ? deny : allow(p.req));
    this.pushState();
  }

  /** Called by the permission MCP endpoint for each tool the CLI wants to run. */
  ask = (a: PermissionAsk): Promise<PermissionVerdict> => {
    if (this.run === 'closed') return Promise.resolve(deny);
    if (this.always.has(permissionKey(a))) return Promise.resolve(allow(a));
    return new Promise((resolve) => {
      const id = randomUUID();
      this.perms.set(id, { req: { id, toolName: a.toolName, input: a.input, toolUseId: a.toolUseId }, resolve });
      this.pushState();
    });
  };

  private denyAll() {
    const all = [...this.perms.values()];
    this.perms.clear();
    for (const p of all) p.resolve(deny);
  }

  private mcpFile() {
    return join(this.cfg.dir, `${this.token}.mcp.json`);
  }

  private ensureProc(): ChatProcess {
    if (this.proc?.alive && !this.stale) return this.proc;
    if (this.proc) {
      const old = this.proc;
      this.proc = undefined;
      old.kill();
    }
    this.stale = false;
    mkdirSync(this.cfg.dir, { recursive: true });
    writeFileSync(this.mcpFile(), permissionMcpConfig(`${this.cfg.baseUrl()}${CHAT_MCP_PATH}${this.token}`));
    const cmd = [
      this.cfg.claudeCmd ?? defaultClaudeCommand(),
      ...buildChatArgs({ resume: this.sessionId, permissionMode: this.mode, mcpConfig: this.mcpFile(), model: this.model }),
    ];
    this.initSeen = false;
    const p: ChatProcess = new ChatProcess(
      this.cfg.spawn ?? bunSpawn,
      cmd,
      { cwd: this.cwd, env: claudeEnv(this.account, this.cfg.env ?? process.env) },
      { onMessage: (m) => this.onMessage(p, m), onExit: (code) => this.onExit(p, code) },
    );
    this.proc = p;
    return p;
  }

  private startTurn(text: string) {
    let p: ChatProcess;
    try {
      p = this.ensureProc();
    } catch (err) {
      this.emit({ type: 'error', message: String((err as Error)?.message ?? err) });
      return;
    }
    this.run = 'running';
    this.emit({ type: 'user', text });
    this.pushState();
    p.sendUser(text);
  }

  private advance() {
    this.run = 'idle';
    const next = this.queue.shift();
    if (next) this.startTurn(next.text);
    else {
      this.pushState();
      this.maybeIdle();
    }
  }

  private onMessage(p: ChatProcess, raw: Record<string, any>) {
    if (p !== this.proc) return;
    for (const e of normalizeLine(raw)) {
      if (e.type === 'init') {
        if (this.initSeen) continue;
        this.initSeen = true;
        if (this.sessionId !== e.sessionId) {
          this.sessionId = e.sessionId;
          this.owner.register(this);
        }
      }
      this.emit(e);
      if (e.type === 'result') this.advance();
    }
  }

  private onExit(p: ChatProcess, code: number) {
    if (p !== this.proc) return;
    this.proc = undefined;
    this.denyAll();
    if (this.run === 'running') {
      this.emit({ type: 'error', message: `claude exited (code ${code})` });
      this.run = 'idle';
    }
    this.pushState();
    this.maybeIdle();
  }

  /** Stops the running turn; when the CLI does not acknowledge, kills the process (the next send resumes the session). */
  async interrupt() {
    const p = this.proc;
    if (this.run !== 'running' || !p) return;
    this.denyAll();
    const ok = await p.interrupt(this.cfg.interruptMs);
    if (ok || p !== this.proc || this.run !== 'running') return;
    this.proc = undefined;
    p.kill();
    this.emit({ type: 'interrupted' });
    this.advance();
  }

  close() {
    if (this.run === 'closed') return;
    clearTimeout(this.idleTimer);
    this.denyAll();
    const p = this.proc;
    this.proc = undefined;
    p?.kill();
    this.run = 'closed';
    rmSync(this.mcpFile(), { force: true });
    this.pushState();
    this.owner.release(this);
  }
}

export type OpenResult = { session: ChatSession } | { error: { code: string; message: string } };

/** All chats of the agents server, by session id; hands the permission MCP endpoint the chat behind a token. */
export function createChatManager(cfg: ChatManagerOptions) {
  const bySession = new Map<string, ChatSession>();
  const byToken = new Map<string, ChatSession>();
  let swept = false;
  const owner = {
    register(s: ChatSession) {
      if (s.sessionId) bySession.set(s.sessionId, s);
    },
    release(s: ChatSession) {
      if (s.sessionId && bySession.get(s.sessionId) === s) bySession.delete(s.sessionId);
      byToken.delete(s.token);
    },
  };

  const sweep = () => {
    if (swept) return;
    swept = true;
    try {
      for (const f of readdirSync(cfg.dir)) if (f.endsWith('.mcp.json')) rmSync(join(cfg.dir, f), { force: true });
    } catch {
      /* no dir yet */
    }
  };

  return {
    open(frame: Omit<ChatOpenFrame, 'type'>): OpenResult {
      sweep();
      const mode = frame.permissionMode && PERMISSION_MODES.includes(frame.permissionMode) ? frame.permissionMode : 'default';
      const accounts = cfg.accounts();
      if (frame.sessionId) {
        const live = bySession.get(frame.sessionId);
        if (live) return { session: live };
        for (const account of accounts) {
          const file = findSessionFile(account.dir, frame.sessionId);
          if (!file) continue;
          const cwd = sessionCwd(file) ?? frame.cwd;
          if (!cwd) return { error: { code: 'noCwd', message: 'Session has no working directory.' } };
          const s = new ChatSession(cfg, owner, cwd, account, mode, frame.model, frame.sessionId);
          owner.register(s);
          byToken.set(s.token, s);
          return { session: s };
        }
        return { error: { code: 'sessionNotFound', message: 'No such session.' } };
      }
      if (!frame.cwd || !existsSync(frame.cwd)) return { error: { code: 'badCwd', message: 'Working directory not found.' } };
      const account = accounts.find((a) => a.id === frame.accountId) ?? accounts.find((a) => a.isDefault) ?? accounts[0];
      if (!account) return { error: { code: 'noAccount', message: 'No Claude account found.' } };
      const s = new ChatSession(cfg, owner, frame.cwd, account, mode, frame.model);
      byToken.set(s.token, s);
      return { session: s };
    },

    /** Applies a client frame other than `open` to the chat it is bound to. */
    handle(session: ChatSession, frame: ChatClientFrame): string | undefined {
      switch (frame.type) {
        case 'send':
          if (typeof frame.text === 'string') session.send(frame.text);
          return undefined;
        case 'queue-edit':
          session.editQueued(String(frame.id), String(frame.text));
          return undefined;
        case 'queue-remove':
          session.removeQueued(String(frame.id));
          return undefined;
        case 'interrupt':
          void session.interrupt();
          return undefined;
        case 'permission':
          session.answer(String(frame.requestId), frame.decision);
          return undefined;
        case 'set-mode':
          session.setMode(frame.mode);
          return undefined;
        default:
          return 'badFrame';
      }
    },

    /** The `POST /api/agents/chat-mcp/<token>` endpoint. */
    async mcp(token: string, body: unknown): Promise<Response> {
      const s = byToken.get(token);
      if (!s) return new Response('Unknown chat', { status: 404 });
      return handleMcpHttp(body, s.ask);
    },

    closeAll() {
      for (const s of [...byToken.values()]) s.close();
    },
  };
}

export type ChatManager = ReturnType<typeof createChatManager>;
