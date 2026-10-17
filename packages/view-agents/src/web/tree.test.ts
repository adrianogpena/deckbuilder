import { describe, expect, test } from 'bun:test';
import type { AgentProject, AgentSessionView, AgentTree } from '../protocol.ts';
import { buildRows, folderName, nextPin, orderSessions, parseTags, projectKey, tagCounts } from './tree';

const tree = (over: Partial<AgentTree> = {}): AgentTree => ({ folders: [], topOrder: [], sessionOrder: {}, collapsed: [], sort: 'manual', view: 'normal', ...over });
const proj = (id: string, name: string): AgentProject => ({ id, name, path: `C:\\src\\${name}\\` });
const sess = (id: string, project: string, status: AgentSessionView['status'] = 'idle', updatedAt = 1, extra: Partial<AgentSessionView> = {}): AgentSessionView =>
  ({ id, account: 'a', cwd: '', title: id, firstPrompt: '', updatedAt, status, project, ...extra });

const projects = [proj('p1', 'beta'), proj('p2', 'Alpha'), proj('p3', 'gamma')];
const key = (name: string) => projectKey(`C:\\src\\${name}\\`);
const shape = (rows: ReturnType<typeof buildRows>) =>
  rows.map((r) => (r.kind === 'folder' ? `F:${r.name}` : r.kind === 'project' ? `${r.depth}P:${r.project.name}` : r.kind === 'session' ? `${r.depth}S:${r.session.id}${r.last ? '.' : ''}` : '--'));

describe('buildRows', () => {
  test('folders first in stored order, then top level stored then alphabetical; collapse hides children', () => {
    const t = tree({ folders: [{ id: 'f1', name: 'Work', projects: [key('gamma')] }, { id: 'f2', name: 'Empty', projects: [] }], collapsed: ['project:' + key('beta')] });
    const rows = buildRows({ tree: t, projects, sessions: [sess('a', 'p1'), sess('b', 'p3'), sess('c', 'p3', 'idle', 5)], filtering: false });
    expect(shape(rows)).toEqual(['F:Work', '1P:gamma', '2S:c', '2S:b.', 'F:Empty', '0P:Alpha', '0P:beta']);
    const beta = rows.find((r) => r.kind === 'project' && r.project.id === 'p1');
    expect(beta?.kind === 'project' && beta.sessions.length).toBe(1);
  });

  test('filtering prunes empty nodes and folders', () => {
    const t = tree({ folders: [{ id: 'f1', name: 'Work', projects: [key('gamma')] }] });
    expect(shape(buildRows({ tree: t, projects, sessions: [sess('a', 'p1')], filtering: true }))).toEqual(['0P:beta', '1S:a.']);
  });

  test('active view puts active nodes first with a divider', () => {
    const t = tree({ view: 'active' });
    const rows = buildRows({ tree: t, projects, sessions: [sess('a', 'p1'), sess('b', 'p3', 'running'), sess('c', 'p2', 'done')], filtering: false });
    expect(shape(rows)).toEqual(['0P:gamma', '1S:b.', '--', '0P:Alpha', '1S:c.', '0P:beta', '1S:a.']);
  });
});

test('orderSessions keeps pins and stored order', () => {
  const list = [sess('a', 'p', 'idle', 1), sess('b', 'p', 'idle', 2, { pin: 'bottom' }), sess('c', 'p', 'idle', 3), sess('d', 'p', 'idle', 4, { pin: 'top' })];
  expect(orderSessions(list, 'manual', ['a', 'c']).map((s) => s.id)).toEqual(['d', 'a', 'c', 'b']);
});

test('nextPin cycles none, top, bottom', () => {
  expect([nextPin(undefined), nextPin('top'), nextPin('bottom')]).toEqual(['top', 'bottom', undefined]);
});

test('folderName collapses whitespace and trims', () => {
  expect(folderName('  a   b \t c ')).toBe('a b c');
  expect(folderName('   ')).toBe('');
});

test('parseTags trims and drops blanks and repeats', () => {
  expect(parseTags(' a, b ,, a , ')).toEqual(['a', 'b']);
  expect(parseTags('')).toEqual([]);
});

test('tagCounts counts per session and sorts case-insensitively then exactly', () => {
  expect(tagCounts([{ tags: ['b', 'A', 'a'] }, { tags: ['a', 'a'] }, {}])).toEqual([
    { tag: 'A', count: 1 },
    { tag: 'a', count: 2 },
    { tag: 'b', count: 1 },
  ]);
});
