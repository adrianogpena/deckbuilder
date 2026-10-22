import { request } from '@deckbuilderkit/ui';

export interface BranchInfo {
  name: string;
  current: boolean;
}

export const listBranches = (project: string) => request<{ branches: BranchInfo[] }>('GET', '/api/agents/git/branches', { project }).then((r) => r.branches);

export interface SessionCommit {
  hash: string;
  subject: string;
  files: string[];
}

/** What a session wrote: repo-relative paths of its edit-tool calls, and the commits since it started that include them. */
export const sessionChanges = (project: string, sessionId: string) =>
  request<{ files: string[]; commits: SessionCommit[] }>('GET', '/api/agents/git/session', { project, sessionId });

/** `POST /api/agents/git/<action>` with `{ project, ...body }`; rejects with git's stderr in the error detail. */
export const gitAction = (action: string, project: string, body: Record<string, unknown> = {}) =>
  request<{ ok: boolean }>('POST', `/api/agents/git/${action}`, {}, { project, ...body });
