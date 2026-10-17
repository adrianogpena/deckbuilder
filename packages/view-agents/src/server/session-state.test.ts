import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStateStore, normalizeTags, SETTLE_AFTER_MS, tagCounts } from './session-state.ts';

test('set merges, clears the name and persists', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'agents-state-')), 'agents', 'session-state.json');
  const s = createSessionStateStore(file);
  expect(s.get('a')).toBeUndefined();
  expect(s.set('a', { pin: 'cycle', name: ' My name ' })).toEqual({ pin: 'top', name: 'My name' });
  expect(s.set('a', { archived: true })).toEqual({ pin: 'top', name: 'My name', archived: true });
  expect(s.set('a', { name: '' })).toEqual({ pin: 'top', archived: true });
  expect(createSessionStateStore(file).get('a')).toEqual({ pin: 'top', archived: true });
});

test('settle archives old stopped sessions once, never after a manual unarchive', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'agents-state-')), 'session-state.json');
  const s = createSessionStateStore(file);
  const now = 10 * SETTLE_AFTER_MS;
  s.set('manual', { archived: false });
  const list = [
    { id: 'old', status: 'stopped', updatedAt: now - SETTLE_AFTER_MS - 1 },
    { id: 'recent', status: 'stopped', updatedAt: now - 1000 },
    { id: 'busy', status: 'working', updatedAt: 0 },
    { id: 'manual', status: 'stopped', updatedAt: 0 },
  ];
  expect(s.settle(list, now)).toBe(true);
  expect(s.get('old')?.archived).toBe(true);
  expect(s.get('recent')).toBeUndefined();
  expect(s.get('busy')).toBeUndefined();
  expect(s.get('manual')?.archived).toBe(false);
  expect(s.settle(list, now)).toBe(false);
});

test('tags: normalise, replace, batch add, remove everywhere, counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-'));
  const store = createSessionStateStore(join(dir, 's.json'));
  expect(normalizeTags(' b, a ,,b, A b ')).toEqual(['b', 'a', 'A b']);
  expect(store.set('s1', { tags: 'x, y ,x' }).tags).toEqual(['x', 'y']);
  expect(store.set('s1', { tags: ' , ' }).tags).toBeUndefined();
  store.set('s1', { tags: 'x,y' });
  store.addTags(['s1', 's2'], 'z, x');
  expect(store.get('s1')!.tags).toEqual(['x', 'y', 'z']);
  expect(store.get('s2')!.tags).toEqual(['z', 'x']);
  store.set('s3', { archived: true, tags: 'x' });
  expect(store.removeTag('x')).toBe(3);
  expect(store.get('s3')!.tags).toBeUndefined();
  expect(createSessionStateStore(join(dir, 's.json')).get('s2')!.tags).toEqual(['z']);
  expect(tagCounts([{ tags: ['b', 'B'] }, { tags: ['a', 'b'] }, {}])).toEqual([{ tag: 'a', count: 1 }, { tag: 'B', count: 1 }, { tag: 'b', count: 2 }]);
});
