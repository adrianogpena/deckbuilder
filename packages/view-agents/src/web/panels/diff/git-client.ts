import type { GitFile, GitFileContent, GitStatus } from '@deckbuilderkit/server-core/protocol';
import { request } from '@deckbuilderkit/ui';

export const gitClient = {
  gitStatus: (root: string) => request<GitStatus>('GET', '/api/agents/git/status', { root }),
  gitFile: (root: string, path: string, from: 'head' | 'index') => request<GitFileContent>('GET', '/api/agents/git/file', { root, path, from }),
  fsRead: (root: string, path: string) => request<{ binary: true } | { text: string; truncated: boolean }>('GET', '/api/agents/fs/read', { root, path }),
};

const EMPTY: GitFileContent = { text: '' };
const orEmpty = (side: GitFileContent) => (side.missing ? EMPTY : side);

async function working(root: string, path: string): Promise<GitFileContent> {
  const read = await gitClient.fsRead(root, path);
  if ('binary' in read) return { binary: true };
  return read.truncated ? { tooLarge: true } : { text: read.text };
}

/** The two sides of a file's diff: staged = HEAD vs index, unstaged = index vs working tree, untracked and conflicts = empty vs working tree. */
export async function sidesOf(root: string, file: GitFile): Promise<{ original: GitFileContent; modified: GitFileContent }> {
  if (file.group === 'conflict' || file.group === 'untracked') return { original: EMPTY, modified: await working(root, file.path) };
  if (file.group === 'staged') {
    const [original, modified] = await Promise.all([
      file.index === 'A' ? EMPTY : gitClient.gitFile(root, file.origPath ?? file.path, 'head').then(orEmpty),
      file.index === 'D' ? EMPTY : gitClient.gitFile(root, file.path, 'index').then(orEmpty),
    ]);
    return { original, modified };
  }
  const [original, modified] = await Promise.all([
    gitClient.gitFile(root, file.path, 'index').then(orEmpty),
    file.worktree === 'D' ? EMPTY : working(root, file.path),
  ]);
  return { original, modified };
}

export const codeOf = (f: GitFile) => (f.group === 'untracked' ? '?' : f.group === 'conflict' ? '!' : f.group === 'staged' ? f.index : f.worktree);
