import { describe, expect, test } from 'bun:test';
import { parseTrackedPrRef, summarizeChecks, toTrackedPr, type PrNode } from './tracked';

describe('parseTrackedPrRef', () => {
  test('url, short form and garbage', () => {
    expect(parseTrackedPrRef(' https://github.com/oven-sh/bun/pull/12/files ')).toEqual({ owner: 'oven-sh', repo: 'bun', number: 12 });
    expect(parseTrackedPrRef('a/b #5')).toEqual({ owner: 'a', repo: 'b', number: 5 });
    expect(parseTrackedPrRef('not a pr')).toBeNull();
  });
});

describe('summarizeChecks', () => {
  test('latest run per name, statuses merged, sorted', () => {
    const s = summarizeChecks([
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: '2026-01-01T00:00:00Z' },
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-01-02T00:00:00Z' },
      { __typename: 'CheckRun', name: 'lint / lint', status: 'IN_PROGRESS', startedAt: '2026-01-02T00:00:00Z' },
      { __typename: 'StatusContext', context: 'ci/x', state: 'FAILURE', targetUrl: 'http://x' },
    ]);
    expect(s.details.map((d) => `${d.name}:${d.state}`)).toEqual(['ci/x:failure', 'lint:pending', 'build:success']);
    expect(s).toMatchObject({ state: 'failed', passed: 1, total: 3 });
  });
  test('none without details', () => {
    expect(summarizeChecks([]).state).toBe('none');
  });
});

describe('toTrackedPr', () => {
  test('maps state, labels and badges', () => {
    const node: PrNode = {
      number: 3,
      title: 'T',
      url: 'u',
      isDraft: false,
      state: 'OPEN',
      headRefName: 'b',
      labels: { nodes: [{ name: 'Ready to merge' }, { name: 'RC-1' }] },
      reviewDecision: 'APPROVED',
      latestReviews: { nodes: [{ state: 'CHANGES_REQUESTED' }] },
    };
    const pr = toTrackedPr(node, { owner: 'o', repo: 'r', number: 3 }, { readyLabel: 'ready to merge', rcLabel: 'rc' });
    expect(pr).toMatchObject({ state: 'open', ready: true, rc: true, reviewDecision: 'APPROVED', changesRequested: true });
  });
});
