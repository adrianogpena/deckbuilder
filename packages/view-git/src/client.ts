import { request } from '@deckbuilderkit/ui';
import type { GitCommit, GitCommitFile, GitDiff, GitFileContent, GitRepoInfo, GitStatus } from '@deckbuilderkit/server-core/protocol';

/** A project the screen can focus. */
export interface GitProject {
  id: string;
  name: string;
  path: string;
}

/** What the screen reads of a file in the working tree. */
export type GitFsRead = { binary: true } | { text: string; truncated: boolean };

/** The server calls the Git view makes; the app builds it from its api and passes it to `gitView`. */
export interface GitClient {
  projects: () => Promise<GitProject[]>;
  gitRepos: () => Promise<GitRepoInfo[]>;
  gitStatus: (root: string) => Promise<GitStatus>;
  gitFile: (root: string, path: string, from: 'head' | 'index' | 'commit' | 'parent', commit?: string) => Promise<GitFileContent>;
  gitLog: (root: string, skip: number, limit: number) => Promise<GitCommit[]>;
  gitCommit: (root: string, commit: string) => Promise<GitCommitFile[]>;
  gitDiff: (root: string, path: string, staged: boolean, commit?: string) => Promise<GitDiff>;
  fsRead: (root: string, path: string) => Promise<GitFsRead>;
}

let current: GitClient | undefined;

/** Set by `gitView`; the screen and its panels call the server through `gitApi`. */
export const bindGitClient = (client: GitClient) => {
  current = client;
};

export const gitApi: GitClient = new Proxy({} as GitClient, {
  get(_, key) {
    if (!current) throw new Error('The Git client is not bound');
    return current[key as keyof GitClient];
  },
});

/** The default `GitClient`: the server's `/api/projects`, `/api/git/*` and `/api/fs/read` routes over fetch. */
export const gitClient: GitClient = {
  projects: () => request<GitProject[]>('GET', '/api/projects'),
  gitRepos: () => request<GitRepoInfo[]>('GET', '/api/git/repos'),
  gitStatus: (root) => request<GitStatus>('GET', '/api/git/status', { root }),
  gitFile: (root, path, from, commit) => request<GitFileContent>('GET', '/api/git/file', { root, path, from, ...(commit && { commit }) }),
  gitLog: (root, skip, limit) => request<GitCommit[]>('GET', '/api/git/log', { root, skip, limit }),
  gitCommit: (root, commit) => request<GitCommitFile[]>('GET', '/api/git/commit', { root, commit }),
  gitDiff: (root, path, staged, commit) =>
    request<GitDiff>('GET', '/api/git/diff', { root, path, staged: staged ? '1' : '0', ...(commit && { commit }) }),
  fsRead: (root, path) => request<GitFsRead>('GET', '/api/fs/read', { root, path }),
};
