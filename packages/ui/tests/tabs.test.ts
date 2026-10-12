import { describe, expect, test } from 'bun:test';
import {
  MAX_PANES,
  activate,
  addTab,
  closeTab,
  closeTabs,
  cycleTab,
  distinguishingFolders,
  findTab,
  focusedPane,
  goBack,
  goForward,
  moveTab,
  navigate,
  newTab,
  restore,
  selectIndex,
  setDirty,
  setPreview,
  pinTab,
  tabsToClose,
  serialize,
  singlePane,
  layoutTree,
  openBeside,
  resizeSplit,
  splitPane,
  splitRight,
  type Layout,
} from '../src/tabs.ts';

interface Route {
  page: string;
  n: number;
}
const isRoute = (x: unknown): x is Route =>
  typeof x === 'object' && x !== null && typeof (x as Route).page === 'string' && typeof (x as Route).n === 'number';
const route = (page: string, n = 1): Route => ({ page, n });
const fallback = () => newTab(route('home'));

function start(): { layout: Layout<Route>; id: string } {
  const tab = newTab(route('notes'));
  return { layout: singlePane(tab), id: tab.id };
}

describe('navigate, back and forward', () => {
  test('navigate pushes history and clears forward', () => {
    const { layout, id } = start();
    let l = navigate(layout, id, route('counter'));
    l = navigate(l, id, route('info'));
    expect(findTab(l, id)?.back).toEqual([route('notes'), route('counter')]);
    l = goBack(l, id);
    expect(findTab(l, id)?.route).toEqual(route('counter'));
    expect(findTab(l, id)?.forward).toEqual([route('info')]);
    l = navigate(l, id, route('notes', 2));
    expect(findTab(l, id)?.forward).toEqual([]);
  });

  test('back and forward walk the history and stop at the ends', () => {
    const { layout, id } = start();
    let l = navigate(layout, id, route('counter'));
    expect(goBack(goBack(l, id), id)).toEqual(goBack(l, id));
    l = goForward(goBack(l, id), id);
    expect(findTab(l, id)?.route).toEqual(route('counter'));
    expect(goForward(l, id)).toEqual(l);
  });

  test('same route is a no-op and replace keeps history', () => {
    const { layout, id } = start();
    expect(navigate(layout, id, route('notes'))).toEqual(layout);
    const l = navigate(layout, id, route('info'), { replace: true });
    expect(findTab(l, id)?.route).toEqual(route('info'));
    expect(findTab(l, id)?.back).toEqual([]);
  });

  test('history is capped at 50', () => {
    const { layout, id } = start();
    let l = layout;
    for (let i = 0; i < 60; i++) l = navigate(l, id, route('notes', i + 2));
    expect(findTab(l, id)?.back.length).toBe(50);
  });
});

describe('closing tabs and panes', () => {
  test('closing the active tab selects its neighbour', () => {
    const { layout, id } = start();
    const b = newTab(route('counter'));
    const c = newTab(route('info'));
    let l = addTab(addTab(layout, b), c);
    l = activate(l, l.focused, b.id);
    l = closeTab(l, b.id, fallback);
    expect(focusedPane(l).tabs.map((t) => t.id)).toEqual([id, c.id]);
    expect(focusedPane(l).active).toBe(c.id);
  });

  test('closing the last tab of a pane removes the pane', () => {
    const { layout, id } = start();
    const l = splitRight(layout, id);
    expect(l.panes.length).toBe(2);
    const second = l.panes[1];
    const closed = closeTab(l, second.tabs[0].id, fallback);
    expect(closed.panes.length).toBe(1);
    expect(closed.focused).toBe(closed.panes[0].id);
  });

  test('closing the only tab leaves one pane with the fallback tab', () => {
    const { layout, id } = start();
    const l = closeTab(layout, id, fallback);
    expect(l.panes.length).toBe(1);
    expect(focusedPane(l).tabs.map((t) => t.route)).toEqual([route('home')]);
  });
});

describe('splitting and moving', () => {
  test('split is capped at MAX_PANES', () => {
    const { layout, id } = start();
    let l = layout;
    for (let i = 0; i < 5; i++) l = splitRight(l, focusedPane(l).tabs[0].id);
    expect(l.panes.length).toBe(MAX_PANES);
    expect(l.panes.flatMap((p) => p.tabs).length).toBe(6);
    expect(findTab(l, id)).toBeDefined();
  });

  test('openBeside creates a pane on the right, then reuses it', () => {
    const { layout } = start();
    const once = openBeside(layout, newTab(route('a')));
    expect(once.panes.length).toBe(2);
    expect(focusedPane(once).tabs.map((t) => t.route)).toEqual([route('a')]);
    const back = activate(once, once.panes[0].id, once.panes[0].active);
    const twice = openBeside(back, newTab(route('b')));
    expect(twice.panes.length).toBe(2);
    expect(twice.panes[1].tabs.map((t) => t.route)).toEqual([route('a'), route('b')]);
  });

  test('split copies the route without history', () => {
    const { layout, id } = start();
    const l = splitRight(navigate(layout, id, route('info')), id);
    const copy = focusedPane(l).tabs[0];
    expect(copy.id).not.toBe(id);
    expect(copy.route).toEqual(route('info'));
    expect(copy.back).toEqual([]);
  });

  test('move to another pane keeps the tab and focuses the target', () => {
    const { layout, id } = start();
    const b = newTab(route('counter'));
    let l = addTab(layout, b);
    l = splitRight(l, id);
    const target = l.panes[1].id;
    l = moveTab(l, b.id, target, 0);
    expect(l.panes[0].tabs.map((t) => t.id)).toEqual([id]);
    expect(l.panes[1].tabs.map((t) => t.id)).toEqual([b.id, l.panes[1].tabs[1].id]);
    expect(l.focused).toBe(target);
    expect(l.panes[1].active).toBe(b.id);
  });

  test('moving the only tab of a pane removes that pane', () => {
    const { layout, id } = start();
    let l = splitRight(layout, id);
    const [first, second] = l.panes;
    l = moveTab(l, second.tabs[0].id, first.id);
    expect(l.panes.length).toBe(1);
    expect(l.panes[0].tabs.length).toBe(2);
  });

  test('move within a pane reorders', () => {
    const { layout, id } = start();
    const b = newTab(route('counter'));
    const l = moveTab(addTab(layout, b), b.id, layout.focused, 0);
    expect(focusedPane(l).tabs.map((t) => t.id)).toEqual([b.id, id]);
  });
});

describe('cycling and selecting', () => {
  test('cycle wraps in both directions', () => {
    const { layout, id } = start();
    const b = newTab(route('counter'));
    const l = addTab(layout, b);
    expect(focusedPane(cycleTab(l, 1)).active).toBe(id);
    expect(focusedPane(cycleTab(cycleTab(l, -1), -1)).active).toBe(b.id);
  });

  test('selectIndex clamps to the last tab', () => {
    const { layout, id } = start();
    const b = newTab(route('counter'));
    const l = addTab(layout, b);
    expect(focusedPane(selectIndex(l, 0)).active).toBe(id);
    expect(focusedPane(selectIndex(l, 8)).active).toBe(b.id);
  });
});

describe('serialize and restore', () => {
  test('round trip keeps panes, tabs and focus but drops history', () => {
    const { layout, id } = start();
    let l = navigate(layout, id, route('info'));
    l = splitRight(l, id);
    const back = restore(JSON.parse(JSON.stringify(serialize(l))), isRoute);
    expect(back?.panes.length).toBe(2);
    expect(back?.focused).toBe(l.focused);
    expect(back?.panes.map((p) => p.tabs.map((t) => t.route))).toEqual(l.panes.map((p) => p.tabs.map((t) => t.route)));
    expect(back?.panes[0].tabs[0].back).toEqual([]);
  });

  test('rejects bad data', () => {
    expect(restore(null, isRoute)).toBeNull();
    expect(restore({}, isRoute)).toBeNull();
    expect(restore({ focused: 'p', panes: 'x' }, isRoute)).toBeNull();
    expect(restore({ focused: 'p', panes: [] }, isRoute)).toBeNull();
  });

  test('drops tabs with invalid routes and panes left empty', () => {
    const raw = {
      focused: 'p2',
      panes: [
        { id: 'p1', active: 'a', tabs: [{ id: 'a', route: { page: 'notes', n: 1 } }, { id: 'b', route: { bogus: true } }] },
        { id: 'p2', active: 'c', tabs: [{ id: 'c', route: 'nope' }] },
      ],
    };
    const l = restore(raw, isRoute);
    expect(l?.panes.length).toBe(1);
    expect(l?.panes[0].tabs.map((t) => t.id)).toEqual(['a']);
    expect(l?.focused).toBe('p1');
  });

  test('falls back to the first tab when active is unknown and caps panes', () => {
    const pane = (id: string) => ({ id, active: 'zzz', tabs: [{ id: `${id}t`, route: route('notes') }] });
    const l = restore({ focused: 'nope', panes: [pane('a'), pane('b'), pane('c'), pane('d'), pane('e')] }, isRoute);
    expect(l?.panes.length).toBe(MAX_PANES);
    expect(l?.panes[0].active).toBe('at');
    expect(l?.focused).toBe('a');
  });
});

describe('split tree', () => {
  const ids = (l: Layout<Route>) => l.panes.map((p) => p.id);

  test('a layout without a tree is one row of its panes', () => {
    const { layout, id } = start();
    expect(layoutTree(layout)).toEqual({ pane: layout.panes[0].id });
    const l = splitRight(layout, id);
    const { tree: _, ...old } = l;
    expect(layoutTree(old)).toEqual({ dir: 'row', children: ids(l).map((pane) => ({ pane })), sizes: [0.5, 0.5] });
  });

  test('split down of a single pane stacks two panes', () => {
    const { layout, id } = start();
    const l = splitPane(layout, id, 'down');
    const [a, b] = ids(l);
    expect(l.tree).toEqual({ dir: 'column', children: [{ pane: a }, { pane: b }], sizes: [0.5, 0.5] });
    expect(l.focused).toBe(b);
  });

  test('split right inside a column nests a row', () => {
    const { layout, id } = start();
    let l = splitPane(layout, id, 'down');
    const [a, b] = ids(l);
    l = splitPane(l, l.panes[1].tabs[0].id, 'right');
    const c = l.focused;
    expect(l.tree).toEqual({
      dir: 'column',
      children: [{ pane: a }, { dir: 'row', children: [{ pane: b }, { pane: c }], sizes: [0.5, 0.5] }],
      sizes: [0.5, 0.5],
    });
  });

  test('a split in the parent direction inserts a sibling and halves the pane', () => {
    const { layout, id } = start();
    let l = splitPane(layout, id, 'right');
    l = resizeSplit(l, [], [0.6, 0.4]);
    l = splitPane(l, id, 'right');
    const [a, c, b] = ids(l);
    expect(l.tree).toEqual({ dir: 'row', children: [{ pane: a }, { pane: c }, { pane: b }], sizes: [0.3, 0.3, 0.4] });
  });

  test('closing a pane collapses a one-child split and gives its size to the neighbours', () => {
    const { layout, id } = start();
    let l = splitPane(layout, id, 'right');
    const [a, b] = ids(l);
    l = splitPane(l, l.panes[1].tabs[0].id, 'down');
    const c = l.focused;
    l = resizeSplit(l, [], [0.4, 0.6]);
    const collapsed = closeTab(l, l.panes.find((p) => p.id === c)!.tabs[0].id, fallback);
    expect(collapsed.tree).toEqual({ dir: 'row', children: [{ pane: a }, { pane: b }], sizes: [0.4, 0.6] });

    let three = splitPane(splitPane(layout, id, 'right'), id, 'right');
    three = resizeSplit(three, [], [0.2, 0.3, 0.5]);
    const middle = three.panes[1];
    const closed = closeTab(three, middle.tabs[0].id, fallback);
    expect(closed.tree).toEqual({ dir: 'row', children: closed.panes.map((p) => ({ pane: p.id })), sizes: [0.2 / 0.7, 0.5 / 0.7] });
  });

  test('a collapsed split in the parent direction merges into it', () => {
    const { layout, id } = start();
    let l = splitPane(layout, id, 'right');
    l = splitPane(l, l.panes[1].tabs[0].id, 'down');
    l = splitPane(l, l.panes[1].tabs[0].id, 'right');
    const [a, b, d, c] = ids(l);
    expect(l.tree).toEqual({
      dir: 'row',
      children: [{ pane: a }, { dir: 'column', children: [{ dir: 'row', children: [{ pane: b }, { pane: d }], sizes: [0.5, 0.5] }, { pane: c }], sizes: [0.5, 0.5] }],
      sizes: [0.5, 0.5],
    });
    const cTab = l.panes.find((p) => p.id === c)!.tabs[0].id;
    l = moveTab(l, cTab, a);
    expect(l.tree).toEqual({ dir: 'row', children: [{ pane: a }, { pane: b }, { pane: d }], sizes: [0.5, 0.25, 0.25] });
  });

  test('resizeSplit ignores a wrong path or size count', () => {
    const { layout, id } = start();
    const l = splitPane(layout, id, 'down');
    expect(resizeSplit(l, [0], [0.5, 0.5])).toBe(l);
    expect(resizeSplit(l, [], [1])).toBe(l);
  });

  test('at MAX_PANES a split adds the copy to the next pane', () => {
    const { layout, id } = start();
    let l = layout;
    for (let i = 1; i < MAX_PANES; i++) l = splitPane(l, id, 'down');
    const before = l.tree;
    const next = splitPane(l, id, 'down');
    expect(next.panes.length).toBe(MAX_PANES);
    expect(next.tree).toEqual(before);
    expect(next.panes[1].tabs.length).toBe(2);
  });

  test('restore keeps a valid tree and reads an old layout as a row', () => {
    const { layout, id } = start();
    const l = splitPane(splitPane(layout, id, 'right'), id, 'down');
    const back = restore(JSON.parse(JSON.stringify(serialize(l))), isRoute);
    expect(back?.tree).toEqual(l.tree);
    const { tree: _, ...old } = serialize(l) as Record<string, unknown>;
    const restoredOld = restore(old, isRoute)!;
    expect(restoredOld.tree).toBeUndefined();
    expect(layoutTree(restoredOld)).toEqual({ dir: 'row', children: ids(l).map((pane) => ({ pane })), sizes: [1 / 3, 1 / 3, 1 / 3] });
  });

  test('restore drops a tree with a missing, duplicated or malformed node', () => {
    const tab = (id: string) => ({ id, active: `${id}t`, tabs: [{ id: `${id}t`, route: route('notes') }] });
    const panes = [tab('a'), tab('b')];
    const bad = [
      { dir: 'row', children: [{ pane: 'a' }, { pane: 'a' }], sizes: [0.5, 0.5] },
      { dir: 'row', children: [{ pane: 'a' }, { pane: 'c' }], sizes: [0.5, 0.5] },
      { dir: 'row', children: [{ pane: 'a' }], sizes: [1] },
      { dir: 'row', children: [{ pane: 'a' }, { pane: 'b' }], sizes: [0.5, 0.3] },
      { dir: 'diag', children: [{ pane: 'a' }, { pane: 'b' }], sizes: [0.5, 0.5] },
    ];
    for (const tree of bad) {
      const l = restore({ focused: 'a', panes, tree }, isRoute);
      expect(l?.tree).toBeUndefined();
      expect(l?.panes.length).toBe(2);
    }
  });

  test('restore prunes panes dropped for invalid routes from the tree', () => {
    const raw = {
      focused: 'a',
      panes: [
        { id: 'a', active: 'x', tabs: [{ id: 'x', route: route('notes') }] },
        { id: 'b', active: 'y', tabs: [{ id: 'y', route: 'nope' }] },
        { id: 'c', active: 'z', tabs: [{ id: 'z', route: route('info') }] },
      ],
      tree: { dir: 'column', children: [{ pane: 'a' }, { dir: 'row', children: [{ pane: 'b' }, { pane: 'c' }], sizes: [0.5, 0.5] }], sizes: [0.5, 0.5] },
    };
    expect(restore(raw, isRoute)?.tree).toEqual({ dir: 'column', children: [{ pane: 'a' }, { pane: 'c' }], sizes: [0.5, 0.5] });
  });

  test('tab changes keep the tree', () => {
    const { layout, id } = start();
    let l = splitPane(layout, id, 'down');
    const tree = l.tree;
    l = activate(addTab(l, newTab(route('x'))), l.panes[0].id, id);
    expect(l.tree).toEqual(tree);
  });
});

describe('dirty and preview tabs', () => {
  function three(): { layout: Layout<Route>; ids: string[] } {
    const a = newTab(route('a'));
    const b = newTab(route('b'));
    const c = newTab(route('c'));
    return { layout: addTab(addTab(singlePane(a), b), c), ids: [a.id, b.id, c.id] };
  }

  test('setDirty marks a tab and editing pins a preview tab', () => {
    const { layout, ids } = three();
    const preview = setPreview(layout, ids[1], true);
    expect(findTab(preview, ids[1])?.preview).toBe(true);
    const dirty = setDirty(preview, ids[1], true);
    expect(findTab(dirty, ids[1])).toMatchObject({ dirty: true });
    expect(findTab(dirty, ids[1])?.preview).toBeUndefined();
    expect(setDirty(dirty, ids[1], true)).toBe(dirty);
    expect(findTab(setDirty(dirty, ids[1], false), ids[1])?.dirty).toBe(false);
  });

  test('pinTab clears the preview flag', () => {
    const { layout, ids } = three();
    const pinned = pinTab(setPreview(layout, ids[0], true), ids[0]);
    expect(findTab(pinned, ids[0])?.preview).toBeUndefined();
    expect(pinTab(layout, ids[0])).toBe(layout);
  });

  test('close modes pick tabs of the pane', () => {
    const { layout, ids } = three();
    const dirty = setDirty(layout, ids[1], true);
    const pick = (mode: Parameters<typeof tabsToClose>[2]) => tabsToClose(dirty, ids[1], mode).map((t) => t.id);
    expect(pick('others')).toEqual([ids[0], ids[2]]);
    expect(pick('right')).toEqual([ids[2]]);
    expect(pick('saved')).toEqual([ids[0], ids[2]]);
    expect(pick('all')).toEqual(ids);
  });

  test('closeTabs closes several and leaves the fallback when none remain', () => {
    const { layout, ids } = three();
    expect(closeTabs(layout, [ids[0], ids[2]], fallback).panes[0].tabs.map((t) => t.id)).toEqual([ids[1]]);
    const none = closeTabs(layout, ids, fallback);
    expect(none.panes[0].tabs.map((t) => t.route)).toEqual([route('home')]);
  });

  test('preview is serialized, dirty is not', () => {
    const { layout, ids } = three();
    const l = setDirty(setPreview(layout, ids[0], true), ids[1], true);
    const back = restore(JSON.parse(JSON.stringify(serialize(l))), isRoute);
    expect(back?.panes[0].tabs.map((t) => t.preview)).toEqual([true, undefined, undefined]);
    expect(back?.panes[0].tabs.some((t) => t.dirty)).toBe(false);
  });
});

describe('distinguishingFolders', () => {
  test('unique titles need no folder', () => {
    expect(distinguishingFolders([{ title: 'a.ts', location: 'p/src' }, { title: 'b.ts', location: 'p/src' }])).toEqual([undefined, undefined]);
  });

  test('same titles get the shortest distinguishing suffix', () => {
    const items = [
      { title: 'index.ts', location: 'p/ui/src' },
      { title: 'index.ts', location: 'p/server/src' },
      { title: 'main.ts', location: 'p/ui/src' },
    ];
    expect(distinguishingFolders(items)).toEqual(['ui/src', 'server/src', undefined]);
    expect(distinguishingFolders([{ title: 'x', location: 'p/a/src' }, { title: 'x', location: 'p/b/src' }])).toEqual(['a/src', 'b/src']);
    expect(distinguishingFolders([{ title: 'x', location: 'p/a' }, { title: 'x', location: 'q' }])).toEqual(['a', 'q']);
  });

  test('tabs without a location or in the same folder are left alone', () => {
    expect(distinguishingFolders([{ title: 'x' }, { title: 'x', location: 'p' }])).toEqual([undefined, undefined]);
    expect(distinguishingFolders([{ title: 'x', location: 'p' }, { title: 'x', location: 'p' }])).toEqual([undefined, undefined]);
  });
});
