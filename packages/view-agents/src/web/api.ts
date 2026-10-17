import { request } from '@deckbuilderkit/ui';
import { listSessions, openSession, type Ticketed } from '@deckbuilderkit/terminal/session';
import type { ChatEvent } from '../chat-protocol.ts';
import type { AgentAccount, AgentProject, AgentRunning, AgentSessionView, AgentsCapWarn, AgentStatus } from '../protocol.ts';

export type { AgentAccount, AgentProject, AgentRunning, AgentSessionView, AgentsCapWarn, AgentStatus };

export const listAccounts = () => request<AgentAccount[]>('GET', '/api/agents/accounts');

interface Prepared {
  ok: boolean;
  sessionId: string;
  launch: { id: string; args: unknown };
  warn?: AgentsCapWarn;
}

/** Thrown by `startSession` when `confirmCap` declined the soft-cap warning. */
export class CapDeclined extends Error {}

/** Starts `claude` in a terminal (new session, or resumes `sessionId`) and returns its Claude session id and terminal ticket. */
export async function startSession(opts: { account: string; dir: string; sessionId?: string; cols?: number; rows?: number; confirmCap?: (w: AgentsCapWarn) => Promise<boolean> }): Promise<Ticketed & { sessionId: string }> {
  const p = await request<Prepared>('POST', '/api/agents/terminal/prepare', {}, { account: opts.account, sessionId: opts.sessionId });
  if (!p.ok) throw new Error('Unknown account');
  if (p.warn && opts.confirmCap && !(await opts.confirmCap(p.warn))) throw new CapDeclined();
  const t = await openSession({ cols: opts.cols ?? 120, rows: opts.rows ?? 30, launch: p.launch, dir: opts.dir });
  return { ...t, sessionId: p.sessionId };
}

/** The live terminal session id running Claude session `sessionId`, if any (from the pty `meta.agentSession`). */
export async function terminalOf(sessionId: string): Promise<string | undefined> {
  const all = await listSessions();
  return all.find((s) => !s.exited && s.meta?.agentSession === sessionId)?.id;
}


export const listAgentSessions = () => request<AgentSessionView[]>('GET', '/api/agents/sessions');

/** Marks a session as seen (clears its `done` state). */
export const sessionHistory = (sessionId: string) => request<{ events: ChatEvent[] }>('GET', '/api/agents/history', { sessionId });

export const markSeen = (sessionId: string) => request<{ ok: boolean }>('POST', '/api/agents/seen', {}, { sessionId });
export const reportShown = (sessionId: string | null) => request<{ ok: boolean }>('POST', '/api/agents/shown', {}, { sessionId });

/** Opens the live socket; `onFrame` gets `{type:'sessions'|'status'}` frames. Returns a close function. */
export async function openAgentsSocket(onFrame: (f: { type: string; [k: string]: any }) => void): Promise<() => void> {
  const { ticket } = await request<{ ticket: string }>('POST', '/api/agents/socket-ticket');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/agents/socket?t=${encodeURIComponent(ticket)}`);
  ws.onmessage = (e) => {
    try { onFrame(JSON.parse(String(e.data))); } catch { /* ignore malformed frames */ }
  };
  return () => ws.close();
}

export const listAgentProjects = () => request<AgentProject[]>('GET', '/api/agents/projects');
export const addAgentProject = (input: { name?: string; path: string }) => request<{ ok: boolean; project?: AgentProject }>('POST', '/api/agents/projects', {}, input);
export const removeAgentProject = (id: string) => request<{ ok: boolean }>('DELETE', '/api/agents/projects', { id });
/** The projects of the Explorer (`/api/projects`), offered as quick adds. */
export const listExplorerProjects = () => request<Array<{ id: string; name: string; path: string }>>('GET', '/api/projects');

/** Stops the chat process of a session before it resumes in a terminal; `busy` while a turn is running. */
export const stopChat = (sessionId: string) => request<{ ok: boolean; busy: boolean }>('POST', '/api/agents/chat/stop', {}, { sessionId });

/** Sessions the previous run left live and that are not live now. */
export const listRecovery = () => request<AgentRunning[]>('GET', '/api/agents/recovery');
export const dismissRecovery = () => request<{ ok: boolean }>('POST', '/api/agents/recovery/dismiss');
/** The soft-cap warning when live terminals + chats reached the cap. */
export const capWarning = async () => (await request<{ warn?: AgentsCapWarn }>('GET', '/api/agents/cap')).warn;
