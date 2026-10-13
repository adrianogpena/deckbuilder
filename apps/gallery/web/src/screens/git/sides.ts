import type { GitFile, GitFileContent } from '@deckbuilder/server-core/protocol';
import { api } from '../../api';

const EMPTY: GitFileContent = { text: '' };

async function working(root: string, path: string): Promise<GitFileContent> {
  const read = await api.fsRead(root, path);
  if ('binary' in read) return { binary: true };
  return read.truncated ? { tooLarge: true } : { text: read.text };
}

const orEmpty = (side: GitFileContent) => (side.missing ? EMPTY : side);

/**
 * The two sides of a changed file: staged = HEAD vs index, unstaged = index vs working file, untracked = empty vs
 * working file, deleted = old side vs empty. A conflict has only the working file (`original` undefined).
 */
export async function sidesOf(root: string, file: GitFile): Promise<{ original?: GitFileContent; modified: GitFileContent }> {
  switch (file.group) {
    case 'conflict':
      return { modified: await working(root, file.path) };
    case 'untracked':
      return { original: EMPTY, modified: await working(root, file.path) };
    case 'staged': {
      const [original, modified] = await Promise.all([
        file.index === 'A' ? EMPTY : api.gitFile(root, file.origPath ?? file.path, 'head').then(orEmpty),
        file.index === 'D' ? EMPTY : api.gitFile(root, file.path, 'index').then(orEmpty),
      ]);
      return { original, modified };
    }
    default: {
      const [original, modified] = await Promise.all([
        api.gitFile(root, file.path, 'index').then(orEmpty),
        file.worktree === 'D' ? EMPTY : working(root, file.path),
      ]);
      return { original, modified };
    }
  }
}

/** The letter shown next to a file and its colour class. */
export function statusOf(file: GitFile): { letter: string; tone: 'ok' | 'warn' | 'err' } {
  if (file.group === 'conflict') return { letter: '!', tone: 'err' };
  if (file.group === 'untracked') return { letter: 'U', tone: 'ok' };
  const letter = file.group === 'staged' ? file.index : file.worktree;
  return { letter, tone: letter === 'A' ? 'ok' : letter === 'D' ? 'err' : 'warn' };
}
