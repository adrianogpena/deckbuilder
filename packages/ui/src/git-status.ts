import type { GitFile } from '@deckbuilder/server-core/protocol';

export type GitStatusTone = 'ok' | 'warn' | 'err';

/** The colour class of a change letter: added green, deleted red, anything else amber. */
export const gitToneOf = (letter: string): GitStatusTone => (letter === 'A' ? 'ok' : letter === 'D' ? 'err' : 'warn');

/** The letter shown next to a file and its colour class. */
export function statusOf(file: GitFile): { letter: string; tone: GitStatusTone } {
  if (file.group === 'conflict') return { letter: '!', tone: 'err' };
  if (file.group === 'untracked') return { letter: 'U', tone: 'ok' };
  const letter = file.group === 'staged' ? file.index : file.worktree;
  return { letter, tone: gitToneOf(letter) };
}
