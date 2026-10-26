import { beforeEach, describe, expect, test } from 'bun:test';
import { validConfig } from '@kedalion/ui/grid';
import { notifyChanges, notifyScope, resetNotifyChanges } from './notify-changes';
import { PODS_FIELDS } from './panels/pods/fields';

interface Item {
  id: string;
  v: string;
}

const o = { key: (i: Item) => i.id, sig: (i: Item) => i.v, title: 'T', line: (i: Item) => i.id };

function ctx() {
  const sent: { title?: string; body: string }[] = [];
  return { sent, notify: async (n: { title?: string; body: string }) => void sent.push(n) };
}

describe('notifyChanges', () => {
  beforeEach(resetNotifyChanges);

  test('the first call only seeds', () => {
    const c = ctx();
    notifyChanges(c, 's', [{ id: 'a', v: '1' }], o);
    expect(c.sent).toEqual([]);
  });

  test('a new item notifies', () => {
    const c = ctx();
    notifyChanges(c, 's', [{ id: 'a', v: '1' }], o);
    notifyChanges(c, 's', [{ id: 'a', v: '1' }, { id: 'b', v: '1' }], o);
    expect(c.sent).toEqual([{ title: 'T', body: 'b' }]);
  });

  test('a changed sig notifies and an unchanged one does not', () => {
    const c = ctx();
    notifyChanges(c, 's', [{ id: 'a', v: '1' }], o);
    notifyChanges(c, 's', [{ id: 'a', v: '1' }], o);
    expect(c.sent).toEqual([]);
    notifyChanges(c, 's', [{ id: 'a', v: '2' }], o);
    expect(c.sent).toHaveLength(1);
  });

  test('one toast with three lines and a count', () => {
    const c = ctx();
    notifyChanges(c, 's', [], o);
    notifyChanges(c, 's', ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, v: '1' })), o);
    expect(c.sent).toEqual([{ title: 'T', body: 'a\nb\nc\nand 2 more' }]);
  });

  test('scopes are independent', () => {
    const c = ctx();
    notifyChanges(c, 's1', [], o);
    notifyChanges(c, 's2', [{ id: 'a', v: '1' }], o);
    expect(c.sent).toEqual([]);
  });

  test('without notify nothing is sent and the state still advances', () => {
    const c = ctx();
    notifyChanges({}, 's', [], o);
    notifyChanges({}, 's', [{ id: 'a', v: '1' }], o);
    notifyChanges(c, 's', [{ id: 'a', v: '1' }], o);
    expect(c.sent).toEqual([]);
  });

  test('a failing notify is swallowed', () => {
    notifyChanges({}, 's', [], o);
    const bad = { notify: () => Promise.reject(new Error('x')) };
    notifyChanges(bad, 's', [], o);
    expect(() => notifyChanges(bad, 's', [{ id: 'a', v: '1' }], o)).not.toThrow();
  });

  test('notifyScope is independent of key order', () => {
    expect(notifyScope('x', { a: 1, b: 2 })).toBe(notifyScope('x', { b: 2, a: 1 }));
  });
});

describe('legacy notifyHealth', () => {
  test('maps to notify, and notify wins', () => {
    expect(validConfig(PODS_FIELDS, { notifyHealth: false }).notify).toBe(false);
    expect(validConfig(PODS_FIELDS, { notifyHealth: false, notify: true }).notify).toBe(true);
    expect(validConfig(PODS_FIELDS, {}).notify).toBe(true);
  });
});
