import { describe, expect, test } from 'bun:test';
import type { AgentProject, AgentSessionView, AgentTree } from '../protocol.ts';
import { buildRows, folderName, leftAction, nextPin, orderSessions, parseTags, projectKey, rightAction, rowToSelectable, selectableToRow, tagCounts, type TreeRow } from './tree';

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

describe('arrow navigation', () => {
  const folder = (collapsed: boolean): TreeRow => ({ kind: 'folder', id: 'f', name: 'F', depth: 0, collapsed, sessions: [], projectIds: [], displayed: [] });
  const proj = (depth: number, collapsed: boolean): TreeRow => ({ kind: 'project', project: {} as AgentProject, key: 'k', node: 'k', depth, collapsed, sessions: [], displayed: [] });
  const sessRow = (depth: number): TreeRow => ({ kind: 'session', session: {} as AgentSessionView, projectKey: 'k', depth, last: true, displayed: [] });
  const div: TreeRow = { kind: 'divider' };
  const rows = [folder(false), proj(1, false), sessRow(2), div, proj(0, true), proj(0, false)];

  test('left collapses expanded nodes, else goes to the parent', () => {
    expect(leftAction(rows, 0)).toEqual({ kind: 'collapse' });
    expect(leftAction(rows, 1)).toEqual({ kind: 'collapse' });
    expect(leftAction(rows, 2)).toEqual({ kind: 'move', to: 1 });
    expect(leftAction([folder(false), proj(1, true)], 1)).toEqual({ kind: 'move', to: 0 });
    expect(leftAction(rows, 4)).toBeUndefined();
    expect(leftAction([sessRow(0)], 0)).toBeUndefined();
  });

  test('right expands collapsed nodes, else moves to a selectable next row', () => {
    expect(rightAction(rows, 4)).toEqual({ kind: 'expand' });
    expect(rightAction(rows, 0)).toEqual({ kind: 'move', to: 1 });
    expect(rightAction(rows, 5)).toBeUndefined();
    expect(rightAction([proj(0, false), div], 0)).toBeUndefined();
    expect(rightAction(rows, 2)).toBeUndefined();
  });

  test('selectable index mapping skips dividers', () => {
    expect(selectableToRow(rows, 3)).toBe(4);
    expect(selectableToRow(rows, 9)).toBe(-1);
    expect(rowToSelectable(rows, 4)).toBe(3);
  });
});
