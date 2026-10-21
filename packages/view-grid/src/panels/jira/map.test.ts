import { describe, expect, test } from 'bun:test';
import { isNotFound, searchV2Request, searchV3Request } from './client';
import { boardLanes, breakdown, daysLeft, groupIssues, mapIssue, mapSprint, pickFieldIds, refreshMs, requestFields, sprintName, statusTone } from './map';

const cloud = { baseUrl: 'https://x.atlassian.net/', user: 'me@x.com', token: 'tok' };
const dc = { baseUrl: 'https://jira.corp', token: 'pat' };

const raw = (key: string, status: string, category: string, extra: Record<string, unknown> = {}) => ({
  key,
  fields: { summary: `s ${key}`, status: { name: status, statusCategory: { key: category } }, ...extra },
});

describe('requests', () => {
  test('v3 body and basic auth', () => {
    const r = searchV3Request(cloud, 'project = A AND x = "b c"', ['summary', 'status'], 15);
    expect(r.url).toBe('https://x.atlassian.net/rest/api/3/search/jql');
    expect(JSON.parse(String(r.init.body))).toEqual({ jql: 'project = A AND x = "b c"', maxResults: 15, fields: ['summary', 'status'] });
    expect((r.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('me@x.com:tok').toString('base64')}`);
  });

  test('v2 url encodes the jql and uses bearer without a user', () => {
    const r = searchV2Request(dc, 'a = "b&c"', ['summary', 'status'], 5);
    const u = new URL(r.url);
    expect(u.pathname).toBe('/rest/api/2/search');
    expect(u.searchParams.get('jql')).toBe('a = "b&c"');
    expect(u.searchParams.get('maxResults')).toBe('5');
    expect(u.searchParams.get('fields')).toBe('summary,status');
    expect((r.init.headers as Record<string, string>).Authorization).toBe('Bearer pat');
  });

  test('fallback only on a 404', () => {
    expect(isNotFound({ opts: { detail: '404 Not Found' } })).toBe(true);
    expect(isNotFound({ opts: { detail: '500 Server Error' } })).toBe(false);
    expect(isNotFound(new Error('x'))).toBe(false);
  });
});

describe('mapping', () => {
  test('status tone by category', () => {
    expect(statusTone('new')).toBe('neutral');
    expect(statusTone('indeterminate')).toBe('info');
    expect(statusTone('done')).toBe('ok');
  });

  test('requestFields adds only the chosen columns', () => {
    expect(requestFields([])).toEqual(['summary', 'status']);
    expect(requestFields(['priority', 'due', 'sprint'], { sprint: 'customfield_1' })).toEqual(['summary', 'status', 'priority', 'duedate', 'customfield_1']);
  });

  test('mapIssue', () => {
    const i = mapIssue(
      raw('A-1', 'In Progress', 'indeterminate', { assignee: { displayName: 'Ann' }, priority: { name: 'High' }, customfield_2: 3, customfield_1: [{ name: 'S1', state: 'closed' }, { name: 'S2', state: 'active' }] }),
      'https://x.atlassian.net/',
      { points: 'customfield_2', sprint: 'customfield_1' },
    );
    expect(i).toMatchObject({ key: 'A-1', status: 'In Progress', tone: 'info', assignee: 'Ann', priority: 'High', points: 3, sprint: 'S2', url: 'https://x.atlassian.net/browse/A-1' });
  });

  test('sprintName handles the legacy string form', () => {
    expect(sprintName(['com.atlassian...Sprint@1[id=1,state=ACTIVE,name=Sprint 7,goal=]'])).toBe('Sprint 7');
    expect(sprintName(null)).toBe('');
  });

  test('pickFieldIds', () => {
    expect(pickFieldIds([{ id: 'customfield_9', name: 'Story point estimate' }, { id: 'customfield_5', name: 'Sprint' }])).toEqual({ points: 'customfield_9', sprint: 'customfield_5' });
  });

  test('refreshMs is never below 60 s', () => {
    expect(refreshMs(1)).toBe(60_000);
    expect(refreshMs(30)).toBe(1_800_000);
    expect(refreshMs(0)).toBe(300_000);
  });
});

describe('grouping', () => {
  const issues = [
    mapIssue(raw('A-1', 'Open', 'new', { assignee: { displayName: 'Ann' } }), 'https://j'),
    mapIssue(raw('A-2', 'Done', 'done'), 'https://j'),
    mapIssue(raw('A-3', 'Open', 'new', { assignee: { displayName: 'Ann' } }), 'https://j'),
  ];

  test('groups in order of first appearance, none gives one group', () => {
    expect(groupIssues(issues, 'none')).toHaveLength(1);
    expect(groupIssues(issues, 'status').map((g) => [g.key, g.issues.length])).toEqual([['Open', 2], ['Done', 1]]);
    expect(groupIssues(issues, 'assignee').map((g) => g.key)).toEqual(['Ann', '']);
  });

  test('board lanes order statuses by category', () => {
    const withDoneFirst = [issues[1], issues[0], mapIssue(raw('A-4', 'Review', 'indeterminate'), 'https://j')];
    expect(boardLanes(withDoneFirst, 'none').map((g) => g.key)).toEqual(['Open', 'Review', 'Done']);
    expect(boardLanes(withDoneFirst, 'assignee').map((g) => g.key)).toEqual(['', 'Ann']);
  });

  test('breakdown sorts by count', () => {
    expect(breakdown(issues, 'status')).toEqual([{ label: 'Open', count: 2 }, { label: 'Done', count: 1 }]);
  });
});

describe('sprint', () => {
  test('lanes by category, progress and days left', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    const list = [raw('A-1', 'Open', 'new'), raw('A-2', 'Doing', 'indeterminate'), raw('A-3', 'Done', 'done'), raw('A-4', 'Done', 'done')].map((r) => mapIssue(r, 'https://j'));
    const s = mapSprint({ name: 'S1', goal: 'ship', endDate: '2026-10-23T12:00:00Z' }, list, now);
    expect(s).toMatchObject({ name: 'S1', goal: 'ship', daysLeft: 3, done: 2, total: 4 });
    expect([s.todo.length, s.doing.length, s.finished.length]).toEqual([1, 1, 2]);
  });

  test('daysLeft', () => {
    expect(daysLeft('2020-01-01T00:00:00Z', Date.now())).toBe(0);
    expect(daysLeft(undefined)).toBeNull();
  });
});
