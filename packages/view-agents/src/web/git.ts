import type { AgentSessionView, GitStatus } from '../protocol.ts';

/** Git status per session cwd, as the latest `git` frame sent it (empty when `agents.gitStatus` is off). */
export type GitStatusMap = Record<string, GitStatus>;

/** Worst case across sessions: max ahead, behind and dirty, each taken separately. Undefined without git data for any session. */
export function projectGitBadge(sessions: AgentSessionView[], status: GitStatusMap): { ahead: number; behind: number; dirty: number } | undefined {
  let found = false;
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const s of sessions) {
    const g = status[s.cwd];
    if (!g) continue;
    found = true;
    ahead = Math.max(ahead, g.ahead);
    behind = Math.max(behind, g.behind);
    dirty = Math.max(dirty, g.dirty);
  }
  return found ? { ahead, behind, dirty } : undefined;
}
