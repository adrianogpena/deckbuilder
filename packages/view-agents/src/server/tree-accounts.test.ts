import { expect, test } from 'bun:test';
import { capPerProject } from './discovery';
import { applyAccountView, applyTreePatch, emptyTree, nodeKeyOf, projectKeyOf, projectNodes } from './tree.ts';

const accounts = [
  { id: '.claude', isDefault: true },
  { id: '.claude-w', isDefault: false, email: 'work@x.com' },
  { id: '.claude-a', isDefault: false, email: 'alpha@x.com' },
];
const sessions = [
  { id: '1', account: '.claude', project: 'p', updatedAt: 3 },
  { id: '2', account: '.claude-w', project: 'p', updatedAt: 2 },
  { id: '3', account: '.claude-a', project: 'p', updatedAt: 1 },
  { id: '4', account: '.claude', project: 'q', updatedAt: 1 },
];
const view = { active: accounts[0], showAllSessions: true, shareProjects: true, showOwner: false };

test('shared projects: one node per project, foreign sessions marked, owner only with showOwner', () => {
  const out = applyAccountView(sessions, accounts, view);
  expect(out.map((s) => s.node)).toEqual(['p', 'p', 'p', 'q']);
  expect(out.map((s) => s.foreign)).toEqual([undefined, true, true, undefined]);
  expect(out.every((s) => s.owner === undefined)).toBe(true);
  const owned = applyAccountView(sessions, accounts, { ...view, showOwner: true });
  expect(owned.map((s) => s.owner)).toEqual([undefined, 'work', 'alpha', undefined]);
});

test('a single account marks nothing foreign', () => {
  const out = applyAccountView(sessions.slice(0, 1), accounts.slice(0, 1), { ...view, showOwner: true });
  expect(out[0]!.foreign).toBeUndefined();
});

test('showAllSessions off hides sessions of other accounts', () => {
  const out = applyAccountView(sessions, accounts, { ...view, showAllSessions: false });
  expect(out.map((s) => s.id)).toEqual(['1', '4']);
  const work = applyAccountView(sessions, accounts, { ...view, showAllSessions: false, active: accounts[1] });
  expect(work.map((s) => s.id)).toEqual(['2']);
});

test('shareProjects off splits nodes per account, sorted by account label, sharing the project key', () => {
  const out = applyAccountView(sessions, accounts, { ...view, shareProjects: false });
  expect(out.map((s) => s.node)).toEqual([nodeKeyOf('p', '.claude'), nodeKeyOf('p', '.claude-w'), nodeKeyOf('p', '.claude-a'), nodeKeyOf('q', '.claude')]);
  expect(out.map((s) => s.nodeSuffix)).toEqual(['default', 'work@x.com', 'alpha@x.com', 'default']);
  const nodes = projectNodes(['q', 'p', 'empty'], out);
  expect(nodes.map((n) => `${n.project}|${n.suffix ?? ''}`)).toEqual(['q|default', 'p|alpha@x.com', 'p|default', 'p|work@x.com', 'empty|']);
  expect(nodes.every((n) => projectKeyOf(n.node) === n.project)).toBe(true);
});

test('capPerProject counts per split node', () => {
  const out = applyAccountView(sessions, accounts, { ...view, shareProjects: false });
  expect(capPerProject(out, 1).map((s) => s.id)).toEqual(['1', '2', '3', '4']);
  expect(capPerProject(applyAccountView(sessions, accounts, view), 1).map((s) => s.id)).toEqual(['1', '4']);
});

test('tree patches on split nodes use the shared project key, collapse stays per node', () => {
  const node = nodeKeyOf('p', '.claude-w');
  const collapsed = applyTreePatch(emptyTree(), { collapse: { key: `project:${node}`, collapsed: true } });
  expect(collapsed.ok && collapsed.tree.collapsed).toEqual([`project:${node}`]);
  const t = { ...emptyTree(), topOrder: ['p', 'q'] };
  const moved = applyTreePatch(t, { move: { kind: 'project', key: node, dir: 1, displayed: [nodeKeyOf('p', '.claude'), node, 'q'] } });
  expect(moved.ok && moved.tree.topOrder).toEqual(['q', 'p']);
  const frozen = applyTreePatch(emptyTree(), { freeze: { [nodeKeyOf('p', '.claude')]: ['1'], [node]: ['2'] } });
  expect(frozen.ok && frozen.tree.sessionOrder).toEqual({ p: ['1', '2'] });
  const first = applyTreePatch(emptyTree(), { newSession: { project: node, id: 'n' } });
  expect(first.ok && first.tree.sessionOrder).toEqual({ p: ['n'] });
});
