import { describe, expect, test } from 'bun:test';
import type { AgentSessionView, AgentStatus } from './api';
import { clampWidth, parseWidths, pruneBatch, reselect, shownOrders, startedCandidates, stepStarted, trackPrevious } from './navigation';
import type { TreeRow } from './tree';

const row = (id: string, status: AgentStatus, projectKey = 'p'): TreeRow => ({ kind: 'session', session: { id, status } as AgentSessionView, projectKey, depth: 1, last: false, displayed: [] });

describe('reselect', () => {
  test('keeps a surviving row', () => {
    expect(reselect(['s:a', 's:b'], 's:b', ['s:b'])).toBe('s:b');
  });
  test('goes to the next surviving row, else the previous, else the first session, else row 0', () => {
    expect(reselect(['s:a', 's:b', undefined, 's:c'], 's:b', ['s:a', 's:c'])).toBe('s:c');
    expect(reselect(['s:a', 's:b', 's:c'], 's:c', ['s:a', 's:b'])).toBe('s:b');
    expect(reselect(['s:a', 's:b'], 's:b', ['p:x', 's:z'])).toBe('s:z');
    expect(reselect(['s:a'], 's:a', ['p:x', 'f:y'])).toBe('p:x');
    expect(reselect(['s:a'], 's:a', [])).toBeUndefined();
  });
});

describe('pruneBatch', () => {
  test('drops ids that no longer exist and keeps the same set otherwise', () => {
    const set = new Set(['a', 'b']);
    expect(pruneBatch(set, ['a', 'b', 'c'])).toBe(set);
    expect([...pruneBatch(set, ['b'])]).toEqual(['b']);
  });
});

describe('trackPrevious', () => {
  test('toggles between two sessions and ignores no selection', () => {
    let st = trackPrevious({}, 'a');
    expect(st).toEqual({ current: 'a', previous: undefined });
    st = trackPrevious(st, 'b');
    expect(st).toEqual({ current: 'b', previous: 'a' });
    expect(trackPrevious(st, undefined)).toBe(st);
    expect(trackPrevious(st, 'b')).toBe(st);
    expect(trackPrevious(st, 'a')).toEqual({ current: 'a', previous: 'b' });
  });
});

describe('started sessions', () => {
  const rows = [row('a', 'idle'), row('b', 'stopped'), row('c', 'done'), row('d', 'starting'), row('e', 'error')];
  test('candidates are all but stopped', () => {
    expect(startedCandidates(rows)).toEqual(['a', 'c', 'd', 'e']);
  });
  test('steps with wrap and handles a non-candidate current', () => {
    const c = ['a', 'c', 'd'];
    expect(stepStarted(c, 'a', 1)).toBe('c');
    expect(stepStarted(c, 'd', 1)).toBe('a');
    expect(stepStarted(c, 'a', -1)).toBe('d');
    expect(stepStarted(c, 'b', 1)).toBe('a');
    expect(stepStarted(c, 'b', -1)).toBe('d');
    expect(stepStarted(c, undefined, 1)).toBe('a');
    expect(stepStarted([], 'a', 1)).toBeUndefined();
  });
});

describe('shownOrders', () => {
  test('groups shown ids per project', () => {
    expect(shownOrders([row('a', 'idle', 'p'), row('b', 'idle', 'q'), row('c', 'idle', 'p')])).toEqual({ p: ['a', 'c'], q: ['b'] });
  });
});

describe('parseWidths', () => {
  test('defaults when missing or malformed', () => {
    expect(parseWidths(null)).toEqual({ sidebar: 260, panel: 320 });
    expect(parseWidths('{oops')).toEqual({ sidebar: 260, panel: 320 });
  });
  test('clamps stored widths', () => {
    expect(parseWidths(JSON.stringify({ sidebar: 900, panel: 10, panelWide: 500 }))).toEqual({ sidebar: 520, panel: 240, panelWide: 500 });
  });
  test('clampWidth uses the region range', () => {
    expect(clampWidth('sidebar', 100)).toBe(220);
    expect(clampWidth('panel', 1000)).toBe(900);
  });
});
