import { describe, expect, test } from 'bun:test';
import {
  MAX_PANES,
  activate,
  addTab,
  closeTab,
  cycleTab,
  findTab,
  focusedPane,
  goBack,
  goForward,
  moveTab,
  navigate,
  newTab,
  restore,
  selectIndex,
  serialize,
  singlePane,
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
  test('split is capped at three panes', () => {
    const { layout, id } = start();
    let l = layout;
    for (let i = 0; i < 5; i++) l = splitRight(l, focusedPane(l).tabs[0].id);
    expect(l.panes.length).toBe(MAX_PANES);
    expect(l.panes.flatMap((p) => p.tabs).length).toBe(6);
    expect(findTab(l, id)).toBeDefined();
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
    const l = restore({ focused: 'nope', panes: [pane('a'), pane('b'), pane('c'), pane('d')] }, isRoute);
    expect(l?.panes.length).toBe(MAX_PANES);
    expect(l?.panes[0].active).toBe('at');
    expect(l?.focused).toBe('a');
  });
});
