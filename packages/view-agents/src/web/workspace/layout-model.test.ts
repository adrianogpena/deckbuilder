import { expect, test } from 'bun:test';

Object.assign(globalThis, { window: { location: { href: 'http://localhost/' }, history: { replaceState() {} }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) } });
const { addTab, newTab, serialize, splitPane } = await import('@deckbuilderkit/ui');
const { agentTabOf, allTabs, dedupeCopies, defaultLayout, EMPTY_KIND, focusedAgentId, openRoute, patchParams, projectPathOf, restoreLayout, routeOf, sameFolder, shellSessions } = await import('./layout-model');

test('a new project opens its live sessions as agent tabs, else one empty tab', () => {
  expect(allTabs(defaultLayout(['a', 'b'])).map((x) => x.route)).toEqual([routeOf('agent', { sessionId: 'a' }), routeOf('agent', { sessionId: 'b' })]);
  expect(allTabs(defaultLayout([])).map((x) => x.route.kind)).toEqual([EMPTY_KIND]);
});

test('a saved layout comes back, unknown kinds included; a bad one is the default', () => {
  const saved = serialize(addTab(defaultLayout(['a']), newTab(routeOf('future', { x: 1 }))));
  const back = restoreLayout(saved, ['z']);
  expect(allTabs(back).map((x) => x.route.kind)).toEqual(['agent', 'future']);
  expect(allTabs(restoreLayout({ nope: true }, ['z'])).map((x) => x.route)).toEqual([routeOf('agent', { sessionId: 'z' })]);
  expect(allTabs(restoreLayout(undefined, [])).map((x) => x.route.kind)).toEqual([EMPTY_KIND]);
});

test('the focused agent session follows the selected tab', () => {
  const l = defaultLayout(['a', 'b']);
  expect(focusedAgentId(l)).toBe('a');
  const withTerminal = addTab(l, newTab(routeOf('terminal')));
  expect(focusedAgentId(withTerminal)).toBeUndefined();
  expect(agentTabOf(withTerminal, 'b')).toBeDefined();
});

test('patchParams merges, removes undefined keys and keeps the tab', () => {
  const l = addTab(defaultLayout([]), newTab(routeOf('terminal', { session: 's1', dir: 'C:/x' })));
  const id = allTabs(l).find((x) => x.route.kind === 'terminal')!.id;
  const next = patchParams(l, id, { session: undefined, gen: 1 });
  expect(allTabs(next).find((x) => x.id === id)!.route.params).toEqual({ dir: 'C:/x', gen: 1 });
  expect(shellSessions(next).size).toBe(0);
  expect(patchParams(l, 'missing', { a: 1 })).toBe(l);
});

test('openRoute puts the tab beside another one in a split', () => {
  const l = defaultLayout(['a']);
  const first = allTabs(l)[0]!.id;
  const r = openRoute(l, routeOf('changes'), first);
  expect(r.layout.panes.length).toBe(2);
  expect(allTabs(r.layout).some((x) => x.id === r.id)).toBe(true);
});

test('a split copy of a shell starts its own shell, of a Claude session or single tool becomes empty', () => {
  const l = addTab(addTab(defaultLayout(['a']), newTab(routeOf('terminal', { session: 's1' }))), newTab(routeOf('usage')));
  const tabs = allTabs(l);
  const shell = tabs.find((x) => x.route.kind === 'terminal')!;
  const single = (kind: string) => kind === 'usage';
  const copyShell = dedupeCopies(l, splitPane(l, shell.id, 'right'), single);
  const added = allTabs(copyShell).filter((x) => !tabs.some((y) => y.id === x.id));
  expect(added.map((x) => x.route.params)).toEqual([{ session: undefined }]);
  const copyAgent = dedupeCopies(l, splitPane(l, tabs[0]!.id, 'right'), single);
  expect(allTabs(copyAgent).filter((x) => !tabs.some((y) => y.id === x.id)).map((x) => x.route.kind)).toEqual([EMPTY_KIND]);
  const copyUsage = dedupeCopies(l, splitPane(l, tabs.find((x) => x.route.kind === 'usage')!.id, 'down'), single);
  expect(allTabs(copyUsage).filter((x) => !tabs.some((y) => y.id === x.id)).map((x) => x.route.kind)).toEqual([EMPTY_KIND]);
});

test('folders match across slash style, trailing slash and case', () => {
  expect(sameFolder('C:\\Work\\App\\', 'c:/work/app')).toBe(true);
  expect(sameFolder('C:/work/app', 'C:/work/other')).toBe(false);
  expect(projectPathOf({ project: 'p', cwd: 'C:/work/app/sub' }, [{ id: 'p', path: 'C:/work/app' }])).toBe('C:/work/app');
  expect(projectPathOf({ cwd: 'C:/loose' }, [])).toBe('C:/loose');
});
