import { describe, expect, test } from 'bun:test';
import { mapNotifications, mapReleases, mapRepoStats, mapRuns, parseRepo, runsPath, runsRefreshMs, runStatus, subjectHtmlUrl } from './more';

describe('subjectHtmlUrl', () => {
  test('maps github.com API urls', () => {
    expect(subjectHtmlUrl('https://api.github.com/repos/o/r/pulls/12')).toBe('https://github.com/o/r/pull/12');
    expect(subjectHtmlUrl('https://api.github.com/repos/o/r/issues/7')).toBe('https://github.com/o/r/issues/7');
  });
  test('releases and commits go to the repo page', () => {
    expect(subjectHtmlUrl('https://api.github.com/repos/o/r/releases/55')).toBe('https://github.com/o/r');
    expect(subjectHtmlUrl('https://api.github.com/repos/o/r/commits/abc')).toBe('https://github.com/o/r');
  });
  test('strips /api/v3 on Enterprise hosts', () => {
    expect(subjectHtmlUrl('https://ghe.corp/api/v3/repos/o/r/pulls/3')).toBe('https://ghe.corp/o/r/pull/3');
  });
  test('falls back to the repo html url', () => {
    expect(subjectHtmlUrl(null, 'https://github.com/o/r')).toBe('https://github.com/o/r');
    expect(subjectHtmlUrl('not a url', 'https://github.com/o/r')).toBe('https://github.com/o/r');
  });
});

describe('runs', () => {
  test('status mapping', () => {
    expect(runStatus('completed', 'success')).toBe('success');
    expect(runStatus('completed', 'timed_out')).toBe('failure');
    expect(runStatus('completed', 'cancelled')).toBe('cancelled');
    expect(runStatus('in_progress', null)).toBe('in_progress');
    expect(runStatus('queued', null)).toBe('queued');
  });
  test('duration and refresh', () => {
    const data = mapRuns({ workflow_runs: [{ id: 1, status: 'in_progress', run_started_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:30Z' }] }, 5);
    expect(data.items[0]?.durationMs).toBe(90_000);
    expect(runsRefreshMs(data)).toBe(60_000);
    expect(runsRefreshMs({ items: [] })).toBe(300_000);
  });
  test('path', () => {
    expect(runsPath('o/r', '', '', 10)).toBe('/repos/o/r/actions/runs?per_page=10');
    expect(runsPath('o/r', 'main', 'ci.yml', 10)).toBe('/repos/o/r/actions/workflows/ci.yml/runs?per_page=10&branch=main');
    expect(parseRepo('bad')).toBe('');
    expect(parseRepo(' o/r ')).toBe('o/r');
  });
});

describe('notifications, releases, repo', () => {
  test('notifications link to html', () => {
    const { items } = mapNotifications([{ id: '1', reason: 'mention', subject: { title: 'T', url: 'https://api.github.com/repos/o/r/pulls/2', type: 'PullRequest' }, repository: { full_name: 'o/r', html_url: 'https://github.com/o/r' } }], 5);
    expect(items[0]?.url).toBe('https://github.com/o/r/pull/2');
  });
  test('releases filter prereleases and drafts', () => {
    const raw = [{ id: 1, tag_name: 'v2-rc', prerelease: true }, { id: 2, tag_name: 'v1' }, { id: 3, tag_name: 'v0', draft: true }];
    expect(mapReleases(raw, 5, false).items.map((r) => r.tag)).toEqual(['v1']);
    expect(mapReleases(raw, 5, true).items.map((r) => r.tag)).toEqual(['v2-rc', 'v1']);
  });
  test('repo stats', () => {
    const s = mapRepoStats({ repository: { stargazerCount: 3, issues: { totalCount: 2 }, defaultBranchRef: { name: 'main', target: { statusCheckRollup: { state: 'SUCCESS' } } } } });
    expect(s?.stars).toBe(3);
    expect(s?.issues).toBe(2);
    expect(s?.ci).toBe('pass');
    expect(mapRepoStats({ repository: null })).toBeUndefined();
  });
});
