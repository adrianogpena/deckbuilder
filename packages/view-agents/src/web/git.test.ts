import { describe, expect, test } from 'bun:test';
import type { AgentSessionView } from '../protocol.ts';
import { projectGitBadge } from './git';

const sess = (id: string, cwd: string): AgentSessionView =>
  ({ id, account: 'a', cwd, title: id, firstPrompt: '', updatedAt: 1, status: 'idle', project: 'p' });

describe('projectGitBadge', () => {
  test('takes the max of each count separately', () => {
    const status = {
      a: { branch: 'main', ahead: 2, behind: 0, dirty: 1 },
      b: { branch: null, ahead: 0, behind: 3, dirty: 5 },
    };
    expect(projectGitBadge([sess('1', 'a'), sess('2', 'b')], status)).toEqual({ ahead: 2, behind: 3, dirty: 5 });
  });

  test('undefined without git data', () => {
    expect(projectGitBadge([sess('1', 'a')], {})).toBeUndefined();
    expect(projectGitBadge([], { a: { branch: 'main', ahead: 1, behind: 0, dirty: 0 } })).toBeUndefined();
  });

  test('clean when all counts are zero', () => {
    expect(projectGitBadge([sess('1', 'a')], { a: { branch: 'main', ahead: 0, behind: 0, dirty: 0 } })).toEqual({ ahead: 0, behind: 0, dirty: 0 });
  });
});
