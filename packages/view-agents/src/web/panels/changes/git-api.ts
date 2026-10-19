import { request } from '@deckbuilderkit/ui';

export interface BranchInfo {
  name: string;
  current: boolean;
}

export const listBranches = (project: string) => request<{ branches: BranchInfo[] }>('GET', '/api/agents/git/branches', { project }).then((r) => r.branches);

/** `POST /api/agents/git/<action>` with `{ project, ...body }`; rejects with git's stderr in the error detail. */
export const gitAction = (action: string, project: string, body: Record<string, unknown> = {}) =>
  request<{ ok: boolean }>('POST', `/api/agents/git/${action}`, {}, { project, ...body });
