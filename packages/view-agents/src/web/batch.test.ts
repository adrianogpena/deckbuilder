import { describe, expect, test } from 'bun:test';
import { batchOrder, distinctKeys, stopOutcome, toggleChecked } from './batch';

describe('toggleChecked', () => {
  test('adds then removes', () => {
    const a = toggleChecked(new Set(), 'x');
    expect([...a]).toEqual(['x']);
    expect([...toggleChecked(a, 'x')]).toEqual([]);
  });
  test('does not mutate the input', () => {
    const s = new Set(['a']);
    toggleChecked(s, 'b');
    expect([...s]).toEqual(['a']);
  });
});

describe('batchOrder', () => {
  test('keeps list order, not check order, and drops repeats', () => {
    const list = [{ id: 'c' }, { id: 'a' }, { id: 'b' }, { id: 'a' }];
    expect(batchOrder(list, new Set(['b', 'a'])).map((x) => x.id)).toEqual(['a', 'b']);
  });
  test('skips unchecked', () => {
    expect(batchOrder([{ id: 'a' }], new Set(['z']))).toEqual([]);
  });
});

describe('distinctKeys', () => {
  test('first-seen order without undefined', () => {
    expect(distinctKeys(['p2', undefined, 'p1', 'p2'])).toEqual(['p2', 'p1']);
  });
});

describe('stopOutcome', () => {
  test('none, all, some', () => {
    expect(stopOutcome({ stopped: 0, notRunning: 3 })).toBe('none');
    expect(stopOutcome({ stopped: 2, notRunning: 0 })).toBe('all');
    expect(stopOutcome({ stopped: 2, notRunning: 1 })).toBe('some');
  });
});
