import type { AgentSessionView, AgentStatus } from './api';

const RANK: Record<AgentStatus, number> = { 'needs-you': 0, error: 1, done: 2, running: 3, idle: 4, stopped: 5 };

export const statusRank = (s: AgentStatus): number => RANK[s] ?? RANK.stopped;

/** Sidebar order within a project: urgency first, then most recently updated. */
export const compareSessions = (a: AgentSessionView, b: AgentSessionView): number =>
  statusRank(a.status) - statusRank(b.status) || b.updatedAt - a.updatedAt;

export const needsYouCount = (sessions: AgentSessionView[]): number => sessions.filter((s) => s.status === 'needs-you').length;

/** Oldest needs-you session, else the oldest unseen done one (external sessions included). */
export function nextWaiting(sessions: AgentSessionView[]): AgentSessionView | undefined {
  const oldest = (status: AgentStatus) => sessions.filter((s) => s.status === status).sort((a, b) => a.updatedAt - b.updatedAt)[0];
  return oldest('needs-you') ?? oldest('done');
}
