import { describe, expect, test } from 'bun:test';
import type { AgentSessionView, AgentStatus } from './api';
import { compareSessions, needsYouCount, nextWaiting, statusCounts } from './attention';

const s = (id: string, status: AgentStatus, updatedAt: number, external = false) => ({ id, status, updatedAt, external }) as AgentSessionView;

describe('attention', () => {
  test('sorts by urgency then recency', () => {
    const list = [s('a', 'idle', 9), s('b', 'running', 5), s('c', 'done', 1), s('d', 'error', 1), s('e', 'needs-you', 1), s('f', 'stopped', 99), s('g', 'needs-you', 7)];
    expect(list.sort(compareSessions).map((x) => x.id)).toEqual(['g', 'e', 'd', 'c', 'b', 'a', 'f']);
  });

  test('nextWaiting prefers the oldest needs-you, else the oldest done', () => {
    expect(nextWaiting([s('a', 'done', 1), s('b', 'needs-you', 5), s('c', 'needs-you', 3, true)])?.id).toBe('c');
    expect(nextWaiting([s('a', 'done', 4), s('b', 'done', 2), s('c', 'running', 1)])?.id).toBe('b');
    expect(nextWaiting([s('a', 'running', 1)])).toBeUndefined();
  });

  test('counts needs-you', () => {
    expect(needsYouCount([s('a', 'needs-you', 1), s('b', 'done', 1), s('c', 'needs-you', 2)])).toBe(2);
  });
});

test('statusCounts keeps unseen done apart from waiting', () => {
  const c = statusCounts([s('a', 'done', 1), s('b', 'needs-you', 1), s('c', 'starting', 1), s('d', 'running', 1), s('e', 'exited', 1), s('f', 'error', 1)]);
  expect(c).toEqual({ running: 2, waiting: 1, done: 1, idle: 0, error: 2, stopped: 0 });
});
