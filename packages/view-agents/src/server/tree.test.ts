import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeState } from './session-state.ts';
import { applyTreePatch, arrangeContainers, createFolder, createTreeStore, deleteFolder, moveToFolder, renameFolder, emptyTree, freezeOrders, moveFolder, moveProject, moveSession, normalizeTree, orderSessions, replaceClearedId, swapDisplayed } from './tree.ts';

const s = (id: string, updatedAt: number, extra: object = {}) => ({ id, status: 'idle' as const, updatedAt, ...extra });

describe('normalizeTree', () => {
  test('drops bad folders, duplicates and unknown values', () => {
    const t = normalizeTree({
      folders: [{ id: 'a', name: ' A ', projects: ['p1', 'p1', 'p2'] }, { id: 'a', name: 'dup', projects: [] }, { id: 'b', name: ' ' }, { name: 'x' }, { id: 'c', name: 'C', projects: ['p2', 'p3'] }],
      topOrder: ['p1', 'p4', 'p4', 'p3'],
      sessionOrder: { p4: ['s1', 's1'], p5: [] },
      collapsed: ['folder:a', 'folder:a', 7],
      sort: 'bogus',
      view: 'active',
    });
    expect(t.folders).toEqual([{ id: 'a', name: 'A', projects: ['p1', 'p2'] }, { id: 'c', name: 'C', projects: ['p3'] }]);
    expect(t.topOrder).toEqual(['p4']);
    expect(t.sessionOrder).toEqual({ p4: ['s1'] });
    expect(t.collapsed).toEqual(['folder:a']);
    expect(t.sort).toBe('manual');
    expect(t.view).toBe('active');
  });
});

describe('arrangeContainers', () => {
  test('folder members in stored order, top by stored then alphabetical', () => {
    const t = { ...emptyTree(), folders: [{ id: 'f', name: 'F', projects: ['b', 'a', 'gone'] }, { id: 'e', name: 'E', projects: [] }], topOrder: ['z', 'y'] };
    const r = arrangeContainers(t, ['a', 'b', 'y', 'm', 'C', 'x'], (k) => k);
    expect(r.folders).toEqual([{ id: 'f', keys: ['b', 'a'] }, { id: 'e', keys: [] }]);
    expect(r.top).toEqual(['y', 'C', 'm', 'x']);
  });
});

describe('orderSessions', () => {
  test('recent mode: pins around the rest', () => {
    const r = orderSessions([s('a', 1, { pin: 'bottom' }), s('b', 5), s('c', 9), s('d', 2, { pin: 'top' })], 'recent');
    expect(r.map((x) => x.id)).toEqual(['d', 'c', 'b', 'a']);
  });
  test('actionable mode ranks by status', () => {
    const r = orderSessions([s('i', 9), { ...s('e', 1), status: 'error' as const }, { ...s('w', 2), status: 'done' as const }, { ...s('r', 3), status: 'starting' as const }], 'actionable');
    expect(r.map((x) => x.id)).toEqual(['e', 'w', 'r', 'i']);
  });
  test('manual mode: id-less and unstored newest first, then stored', () => {
    const r = orderSessions([s('x', 1), s('b', 2), s('n1', 3), s('n2', 4), s('', 5, { idless: true }), s('', 6, { idless: true, pending: true }), s('a', 0, { pin: 'top' })], 'manual', ['x', 'b']);
    expect(r.map((x) => x.id)).toEqual(['a', '', '', 'n2', 'n1', 'x', 'b']);
    expect(r[1]!.updatedAt).toBe(6);
  });
});

describe('freeze', () => {
  test('prepends only missing ids and keeps the tree when unchanged', () => {
    const t = { ...emptyTree(), sessionOrder: { p: ['a', 'z'] } };
    const f = freezeOrders(t, { p: ['b', 'a', 'c'], q: ['x'] });
    expect(f.sessionOrder).toEqual({ p: ['b', 'c', 'a', 'z'], q: ['x'] });
    expect(freezeOrders(f, { p: ['a', 'b'] })).toBe(f);
  });
  test('cleared id goes before the old one in manual mode only', () => {
    const t = { ...emptyTree(), sessionOrder: { p: ['a', 'old', 'b'] } };
    expect(replaceClearedId(t, 'p', 'old', 'new').sessionOrder.p).toEqual(['a', 'new', 'old', 'b']);
    const recent = { ...t, sort: 'recent' as const };
    expect(replaceClearedId(recent, 'p', 'old', 'new')).toBe(recent);
  });
});

describe('moves', () => {
  test('folder swap and ends', () => {
    const t = { ...emptyTree(), folders: [{ id: 'a', name: 'A', projects: [] }, { id: 'b', name: 'B', projects: [] }] };
    expect(moveFolder(t, 'a', 1)!.folders.map((f) => f.id)).toEqual(['b', 'a']);
    expect(moveFolder(t, 'a', -1)).toBeNull();
    expect(moveFolder(t, 'b', 1)).toBeNull();
  });
  test('project swap appends missing displayed keys and keeps hidden positions', () => {
    expect(swapDisplayed(['a', 'h', 'b'], ['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'h', 'a', 'c']);
    expect(swapDisplayed([], ['a', 'b'], 'b', 1)).toBeNull();
    expect(swapDisplayed([], ['a', 'b'], 'zz', 1)).toBeNull();
    const t = { ...emptyTree(), folders: [{ id: 'f', name: 'F', projects: ['a', 'b'] }] };
    expect(moveProject(t, 'b', -1, ['a', 'b'], 'f')!.folders[0]!.projects).toEqual(['b', 'a']);
    expect(moveProject(t, 'q', 1, ['q', 'r'])!.topOrder).toEqual(['r', 'q']);
  });
  test('session move needs an id', () => {
    const t = { ...emptyTree(), sessionOrder: { p: ['a', 'b'] } };
    expect(moveSession(t, 'p', 'a', 1, ['a', 'b'])!.sessionOrder.p).toEqual(['b', 'a']);
    expect(moveSession(t, 'p', '', 1, ['', 'b'])).toBeNull();
  });
  test('reorders are refused in the active view', () => {
    const t = { ...emptyTree(), view: 'active' as const, sessionOrder: { p: ['a', 'b'] } };
    const r = applyTreePatch(t, { move: { kind: 'session', project: 'p', id: 'a', dir: 1, displayed: ['a', 'b'] } });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe('activeView');
  });
  test('collapse is duplicate-free', () => {
    let t = emptyTree();
    t = applyTreePatch(t, { collapse: { key: 'folder:a', collapsed: true } }).tree;
    t = applyTreePatch(t, { collapse: { key: 'folder:a', collapsed: true } }).tree;
    expect(t.collapsed).toEqual(['folder:a']);
    expect(applyTreePatch(t, { collapse: { key: 'folder:a', collapsed: false } }).tree.collapsed).toEqual([]);
  });
});

describe('store', () => {
  test('patches persist and a corrupt file is moved aside', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tree-'));
    const file = join(dir, 'tree.json');
    writeFileSync(file, '[1]');
    const store = createTreeStore(file);
    expect((await store.read()).sort).toBe('manual');
    const r = await store.patch({ sort: 'recent' });
    expect(r.ok).toBe(true);
    expect((await createTreeStore(file).read()).sort).toBe('recent');
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
  });
});

describe('pin migration', () => {
  test('pinned true becomes top; junk pins are dropped', () => {
    expect(normalizeState({ pinned: true, name: 'n' })).toEqual({ name: 'n', pin: 'top' });
    expect(normalizeState({ pinned: false })).toEqual({});
    expect(normalizeState({ pin: 'bottom', pinned: true })).toEqual({ pin: 'bottom' });
    expect(normalizeState({ pin: 'x' })).toEqual({});
  });
});

describe('folders', () => {
  const base = () => ({ ...emptyTree(), folders: [{ id: 'a', name: 'A', projects: ['p1', 'p2'] }, { id: 'b', name: 'B', projects: ['p3'] }], topOrder: ['p4'], collapsed: ['folder:a', 'folder:b'] });
  test('create normalises and appends; blank is a no-op', () => {
    const t = createFolder(base(), '  my   new  folder ')!;
    expect(t.folders.map((f) => f.name)).toEqual(['A', 'B', 'my new folder']);
    expect(createFolder(base(), '   ')).toBeNull();
    expect(applyTreePatch(base(), { folderCreate: { name: ' ' } })).toMatchObject({ ok: false, error: 'noop' });
  });
  test('rename trims ends only and ignores blank', () => {
    expect(renameFolder(base(), 'a', '  x  y ')!.folders[0]!.name).toBe('x  y');
    expect(renameFolder(base(), 'a', ' ')).toBeNull();
  });
  test('delete puts members first in the top order and drops the collapse key', () => {
    const t = deleteFolder(base(), 'a')!;
    expect(t.folders.map((f) => f.id)).toEqual(['b']);
    expect(t.topOrder).toEqual(['p1', 'p2', 'p4']);
    expect(t.collapsed).toEqual(['folder:b']);
  });
  test('move to folder removes from everywhere then appends', () => {
    const t = moveToFolder(base(), ['p4', 'p1', 'p4'], 'b')!;
    expect(t.folders.map((f) => f.projects)).toEqual([['p2'], ['p3', 'p4', 'p1']]);
    expect(t.topOrder).toEqual([]);
    const top = moveToFolder(base(), ['p3', 'p1'])!;
    expect(top.folders.map((f) => f.projects)).toEqual([['p2'], []]);
    expect(top.topOrder).toEqual(['p4', 'p3', 'p1']);
    expect(moveToFolder(base(), ['p1'], 'zz')).toBeNull();
  });
});
