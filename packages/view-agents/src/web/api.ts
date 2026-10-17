import { request, stream } from '@deckbuilderkit/ui';
import { listSessions, openSession, type Ticketed } from '@deckbuilderkit/terminal/session';
import type { ChatEvent } from '../chat-protocol.ts';
import { t } from '../i18n';
import type { AgentDeleteResult, AgentRestoreResult, AgentTrashEntry, AgentTrashError, AgentLaunch, AgentLifecycleError, AgentStopResult, AgentAccount,AgentAccountUsage, AgentProject, AgentRateLimit, AgentRunning, AgentSearchHit, AgentSessionView, AgentsCapWarn, AgentStatus, AgentStatuslineError, AgentStatuslineStatus, AgentTagCount, AgentTree, AgentTreePatch } from '../protocol.ts';

export type { AgentAccount, AgentAccountUsage, AgentProject, AgentRateLimit, AgentRunning, AgentSearchHit, AgentSessionView, AgentsCapWarn, AgentStatus, AgentStatuslineError, AgentStatuslineStatus, AgentTagCount, AgentTree, AgentTreePatch };

export const listAccounts = () => request<AgentAccount[]>('GET', '/api/agents/accounts');

/** Thrown by `startSession` when `confirmCap` declined the soft-cap warning. */
export class CapDeclined extends Error {}

/** The message of a refused start / restart / stop. */
export function lifecycleMessage(r: { error?: AgentLifecycleError; cwd?: string }): string {
  if (r.error === 'cwdMissing') return t('agents.cwdMissing', { cwd: r.cwd ?? '' });
  if (r.error === 'external') return t('agents.openElsewhere');
  if (r.error === 'busy') return t('agents.mode.busy');
  return t('agents.startFailed');
}

const launchOf = async (
  p: AgentLaunch,
  opts: { dir: string; cols?: number; rows?: number; confirmCap?: (w: AgentsCapWarn) => Promise<boolean> },
): Promise<Ticketed & { sessionId: string }> => {
  if (!p.ok) throw new Error(lifecycleMessage(p));
  if (p.warn && opts.confirmCap && !(await opts.confirmCap(p.warn))) throw new CapDeclined();
  const ticket = await openSession({ cols: opts.cols ?? 120, rows: opts.rows ?? 30, launch: p.launch, dir: opts.dir });
  return { ...ticket, sessionId: p.sessionId };
};

/** Starts `claude` in a terminal (new session, or resumes `sessionId`) and returns its Claude session id and terminal ticket. The folder is checked first. */
export async function startSession(opts: { account: string; dir: string; sessionId?: string; cols?: number; rows?: number; confirmCap?: (w: AgentsCapWarn) => Promise<boolean> }): Promise<Ticketed & { sessionId: string }> {
  return launchOf(await request<AgentLaunch>('POST', '/api/agents/terminal/prepare', {}, { account: opts.account, sessionId: opts.sessionId, dir: opts.dir }), opts);
}

/** Starts (resumes) a session without attaching a pane: the terminal keeps running and is found by `terminalOf` later. */
export const startInBackground = startSession;

/** Stops a session: done/error acknowledged, agent killed; `removed` when nothing was sent so it no longer exists. */
export async function stopSession(sessionId: string): Promise<{ removed: boolean }> {
  const r = await request<AgentStopResult>('POST', '/api/agents/session/stop', {}, { sessionId });
  if (!r.ok) throw new Error(lifecycleMessage(r));
  return { removed: r.removed === true };
}

/** Restarts a session: the old process ends and a new run starts (fresh conversation when there is no transcript to resume). */
export async function restartSession(sessionId: string, opts: { cols?: number; rows?: number } = {}): Promise<Ticketed & { sessionId: string }> {
  const p = await request<AgentLaunch>('POST', '/api/agents/session/restart', {}, { sessionId });
  return launchOf(p, { dir: p.ok ? (p.cwd ?? '') : '', ...opts });
}

/** The live terminal session id running Claude session `sessionId`, if any (from the pty `meta.agentSession`). */
export async function terminalOf(sessionId: string): Promise<string | undefined> {
  const all = await listSessions();
  return all.find((s) => !s.exited && s.meta?.agentSession === sessionId)?.id;
}


export const listAgentSessions = () => request<AgentSessionView[]>('GET', '/api/agents/sessions');

/** Marks a session as seen (clears its `done` state). */
export const lastResponse = (sessionId: string) => request<{ text: string | null }>('GET', '/api/agents/last-response', { sessionId });
export const sessionHistory = (sessionId: string) => request<{ events: ChatEvent[] }>('GET', '/api/agents/history', { sessionId });

/** Mark unread: done / error become unseen again; a session with no status gets a fresh done. */
export const markUnread = (sessionId: string) => request<{ ok: boolean }>('POST', '/api/agents/unread', {}, { sessionId });
export const markSeen = (sessionId: string) => request<{ ok: boolean }>('POST', '/api/agents/seen', {}, { sessionId });
export const reportShown = (sessionId: string | null) => request<{ ok: boolean }>('POST', '/api/agents/shown', {}, { sessionId });

export interface TailTurn { role: 'user' | 'assistant'; text: string }
const tailListeners = new Set<(sessionId: string, turns: TailTurn[]) => void>();
/** Subscribes to `tail` frames of the agents socket; returns the unsubscribe. */
export function onTail(fn: (sessionId: string, turns: TailTurn[]) => void): () => void {
  tailListeners.add(fn);
  return () => void tailListeners.delete(fn);
}
/** Tells the server which external session's transcript is previewed (null: none). */
export const reportPreview = (sessionId: string | null) => request<{ ok: boolean }>('POST', '/api/agents/preview', {}, { sessionId });

/** Opens the live socket; `onFrame` gets `{type:'sessions'|'status'|'usage'}` frames. Returns a close function. */
export async function openAgentsSocket(onFrame: (f: { type: string; [k: string]: any }) => void): Promise<() => void> {
  const { ticket } = await request<{ ticket: string }>('POST', '/api/agents/socket-ticket');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/agents/socket?t=${encodeURIComponent(ticket)}`);
  ws.onmessage = (e) => {
    try {
      const f = JSON.parse(String(e.data));
      if (f.type === 'tail') for (const l of tailListeners) l(f.sessionId, f.turns);
      onFrame(f);
    } catch { /* ignore malformed frames */ }
  };
  return () => ws.close();
}

export type { AgentAlert } from '../server/alerts.ts';
export const listAlerts = () => request<import('../server/alerts.ts').AgentAlert[]>('GET', '/api/agents/alerts');
export const listAgentProjects = () => request<AgentProject[]>('GET', '/api/agents/projects');
export const addAgentProject = (input: { name?: string; path: string }) => request<{ ok: boolean; project?: AgentProject }>('POST', '/api/agents/projects', {}, input);
export const removeAgentProject = (id: string) => request<{ ok: boolean }>('DELETE', '/api/agents/projects', { id });
/** The projects of the Explorer (`/api/projects`), offered as quick adds. */
export const listExplorerProjects = () => request<Array<{ id: string; name: string; path: string }>>('GET', '/api/projects');
/** Explorer projects not added yet (hidden ones included: adding one back un-hides it). */
export const listProjectSuggestions = () => request<Array<{ name: string; path: string }>>('GET', '/api/agents/projects/suggestions');

/** Stops the chat process of a session before it resumes in a terminal; `busy` while a turn is running. */
export const stopChat = (sessionId: string) => request<{ ok: boolean; busy: boolean }>('POST', '/api/agents/chat/stop', {}, { sessionId });

/** Sessions the previous run left live and that are not live now. */
export const listRecovery = () => request<AgentRunning[]>('GET', '/api/agents/recovery');
export const dismissRecovery = () => request<{ ok: boolean }>('POST', '/api/agents/recovery/dismiss');
/** The soft-cap warning when live terminals + chats reached the cap. */
export const capWarning = async () => (await request<{ warn?: AgentsCapWarn }>('GET', '/api/agents/cap')).warn;

export type StatuslineResult = { ok: true; status: AgentStatuslineStatus } | { ok: false; error: AgentStatuslineError };

export const listStatusline = () => request<AgentStatuslineStatus[]>('GET', '/api/agents/statusline');

export const installStatusline = (account: string) => request<StatuslineResult>('POST', '/api/agents/statusline/install', {}, { account });

export const uninstallStatusline = (account: string) => request<StatuslineResult>('POST', '/api/agents/statusline/uninstall', {}, { account });

/** Pins (`pin: 'cycle'` steps none > top > bottom > none), renames (`name` '' or null clears) or archives a session; a sessions frame follows. */
export const patchSessionState = (id: string, state: { pin?: 'top' | 'bottom' | 'none' | null | 'cycle'; name?: string | null; archived?: boolean; tags?: string[] }) =>
  request<{ ok: boolean }>('PATCH', '/api/agents/session-state', {}, { id, ...state });

/** Distinct tags with the number of listed sessions carrying each. */
export const listTags = () => request<AgentTagCount[]>('GET', '/api/agents/tags');
/** Appends tags (input order) to each session id, keeping the existing ones; never replaces. */
export const addTags = (ids: string[], tags: string[]) => request<{ ok: boolean }>('POST', '/api/agents/tags/add', {}, { ids, tags });
/** Removes a tag from every session; `count` = sessions changed. */
export const removeTagEverywhere = (tag: string) => request<{ ok: boolean; count: number }>('POST', '/api/agents/tags/remove', {}, { tag });

/** The stored sidebar tree (folders, manual orders, collapse, sort, view). */
export const getTree = () => request<AgentTree>('GET', '/api/agents/tree');
export type TreePatchResult = { ok: boolean; error?: 'activeView' | 'noop' | 'invalid'; tree: AgentTree };
export const patchTree = (patch: AgentTreePatch) => request<TreePatchResult>('PATCH', '/api/agents/tree', {}, patch);

export const getNotes = (project: string) => request<{ text: string }>('GET', '/api/agents/notes', { project });

export const putNotes = (project: string, text: string) => request<{ ok: boolean }>('PUT', '/api/agents/notes', {}, { project, text });

/** Server full-text search over prompts and replies; `onHit` per session with its first matching snippet. */
export const searchSessions = (q: string, onHit: (hit: AgentSearchHit) => void, signal?: AbortSignal) =>
  stream('/api/agents/search', { q }, (item) => onHit(item as AgentSearchHit), signal);

const trashMessage = (e: AgentTrashError): string =>
  e === 'running' ? t('agents.delete.running') : e === 'nothing' ? t('agents.delete.nothing') : e === 'exists' ? t('agents.trash.exists') : e === 'empty' ? t('agents.trash.undoEmpty') : t('agents.trash.gone');

/** User-visible text of a delete / restore refusal code. */
export { trashMessage };

/** Moves sessions to the trash; per-id outcomes (`skipped[].error` is a code, see `trashMessage`). */
export const deleteSessions = (ids: string[]) => request<AgentDeleteResult>('POST', '/api/agents/session/delete', {}, { ids });

/** Deletes one session; throws an Error with the refusal text when it was skipped. */
export async function deleteSession(id: string): Promise<void> {
  const r = await deleteSessions([id]);
  const s = r.skipped[0];
  if (s) throw new Error(trashMessage(s.error));
}

export const listTrash = () => request<AgentTrashEntry[]>('GET', '/api/agents/trash');

export const restoreTrashed = (id: string) => request<AgentRestoreResult>('POST', '/api/agents/trash/restore', {}, { id });

/** Restores the most recently deleted session of this run; `{ok:false, error:'empty'}` when there is none. */
export const undoDelete = () => request<AgentRestoreResult>('POST', '/api/agents/trash/undo', {}, {});
