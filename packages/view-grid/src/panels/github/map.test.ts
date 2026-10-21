import { describe, expect, test } from 'bun:test';
import { buildQuery, mapIssues, mapPullRequests, nextRefreshMs, reduceChecks, searchRefreshMs, ticketKey } from './map';

describe('buildQuery', () => {
  test('fixed modes', () => {
    expect(buildQuery('pr', 'mine', '', '')).toBe('is:pr is:open author:@me');
    expect(buildQuery('pr', 'closed', '', '')).toBe('is:pr is:closed author:@me sort:updated-desc');
    expect(buildQuery('issue', 'assigned', '', '')).toBe('is:issue is:open assignee:@me');
  });
  test('repo mode needs owner/name', () => {
    expect(buildQuery('pr', 'repo', 'a/b', '')).toBe('is:pr is:open repo:a/b');
    expect(buildQuery('issue', 'repo', 'a/b', '')).toBe('is:issue is:open repo:a/b');
    expect(buildQuery('pr', 'repo', '', '')).toBeNull();
    expect(buildQuery('pr', 'repo', 'nope', '')).toBeNull();
  });
  test('custom query gets the type prefix once', () => {
    expect(buildQuery('pr', 'custom', '', 'org:x label:bug')).toBe('is:pr org:x label:bug');
    expect(buildQuery('pr', 'custom', '', 'is:pr org:x')).toBe('is:pr org:x');
    expect(buildQuery('pr', 'custom', '', ' ')).toBeNull();
  });
});

describe('reduceChecks', () => {
  test('states', () => {
    expect(reduceChecks(null)).toEqual({ state: 'none', failing: [] });
    expect(reduceChecks({ state: 'SUCCESS' })).toEqual({ state: 'pass', failing: [] });
    expect(reduceChecks({ state: 'PENDING' }).state).toBe('pending');
  });
  test('failing names', () => {
    const r = reduceChecks({
      state: 'FAILURE',
      contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', conclusion: 'FAILURE' }, { __typename: 'CheckRun', name: 'lint', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', context: 'ci/x', state: 'ERROR' }] },
    });
    expect(r).toEqual({ state: 'fail', failing: ['build', 'ci/x'] });
  });
});

describe('ticketKey', () => {
  test('title first, then branch', () => {
    expect(ticketKey('ABC-12 fix', 'feat/XYZ-3', '')).toBe('ABC-12');
    expect(ticketKey('fix', 'feat/XYZ-3-thing', '')).toBe('XYZ-3');
    expect(ticketKey('fix', 'main', '')).toBe('');
  });
  test('bad pattern falls back to the default', () => {
    expect(ticketKey('ABC-1', '', '(')).toBe('ABC-1');
  });
});

describe('nextRefreshMs', () => {
  test('ok quota gives nothing', () => expect(nextRefreshMs({ remaining: 500, limit: 5000 }, 300_000)).toBeUndefined());
  test('low quota doubles up to 15 min', () => {
    expect(nextRefreshMs({ remaining: 10, limit: 5000 }, 300_000)).toBe(600_000);
    expect(nextRefreshMs({ remaining: 10, limit: 5000 }, 300_000, 600_000)).toBe(900_000);
    expect(nextRefreshMs({ remaining: 10, limit: 5000 }, 300_000, 900_000)).toBe(900_000);
  });
});

describe('mapping', () => {
  test('pull requests', () => {
    const d = mapPullRequests(
      {
        search: {
          issueCount: 7,
          nodes: [
            null,
            { number: 3, url: 'u3', title: 'ABC-9 x', isDraft: true, state: 'OPEN', headRefName: 'b', reviewDecision: 'APPROVED', author: { login: 'me' }, repository: { nameWithOwner: 'a/b' }, labels: { nodes: [{ name: 'bug' }] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, updatedAt: 't' },
          ],
        },
      },
      '',
    );
    expect(d.total).toBe(7);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ draft: true, review: 'approved', ci: 'pass', ticket: 'ABC-9', labels: ['bug'], repo: 'a/b' });
  });
  test('issues', () => {
    const d = mapIssues({ search: { nodes: [{ number: 1, url: 'u', title: 't', comments: { totalCount: 4 }, assignees: { nodes: [{ login: 'z' }] }, milestone: { title: 'M' } }] } });
    expect(d.items[0]).toMatchObject({ comments: 4, assignees: ['z'], milestone: 'M' });
  });
});

describe('searchRefreshMs', () => {
  test('5 min, 60 s while pending, never below 60 s', () => {
    expect(searchRefreshMs({ items: [{ ci: 'pass' }] })).toBe(300_000);
    expect(searchRefreshMs({ items: [{ ci: 'pending' }] })).toBe(60_000);
    expect(searchRefreshMs({ items: [{ ci: 'pending' }], nextRefreshMs: 600_000 })).toBe(600_000);
  });
});
