import { STATUS_CATEGORY } from '../protocol.ts';
import type { AgentSessionView, AgentStatus } from './api';

const RANK: Record<AgentStatus, number> = { 'needs-you': 0, error: 1, exited: 2, done: 3, running: 4, starting: 5, idle: 6, stopped: 7 };

export const statusRank = (s: AgentStatus): number => RANK[s] ?? RANK.stopped;

/** Sidebar order within a project: pinned first, then urgency, then most recently updated. */
export const compareSessions = (a: AgentSessionView, b: AgentSessionView): number =>
  Number(!!b.pinned) - Number(!!a.pinned) || statusRank(a.status) - statusRank(b.status) || b.updatedAt - a.updatedAt;

/** The name a session shows: the app-side name, else the title, first prompt or short id. */
export const displayName = (s: AgentSessionView): string => s.name || s.title || s.firstPrompt || s.id.slice(0, 8);

export const needsYouCount = (sessions: AgentSessionView[]): number => sessions.filter((s) => s.status === 'needs-you').length;

/** Oldest needs-you session, else the oldest unseen done one (external sessions included). */
export function nextWaiting(sessions: AgentSessionView[]): AgentSessionView | undefined {
  const oldest = (status: AgentStatus) => sessions.filter((s) => s.status === status).sort((a, b) => a.updatedAt - b.updatedAt)[0];
  return oldest('needs-you') ?? oldest('done');
}

export interface StatusCounts {
  running: number;
  waiting: number;
  /** Unseen done, its own bucket apart from waiting. */
  done: number;
  idle: number;
  error: number;
  stopped: number;
}

/** Sessions per category; Done unseen is counted apart from waiting. */
export function statusCounts(sessions: AgentSessionView[]): StatusCounts {
  const c: StatusCounts = { running: 0, waiting: 0, done: 0, idle: 0, error: 0, stopped: 0 };
  for (const s of sessions) c[s.status === 'done' ? 'done' : STATUS_CATEGORY[s.status] ?? 'stopped']++;
  return c;
}
