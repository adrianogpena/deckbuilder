import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrashStore, DAY_MS, isSafeId } from './trash.ts';

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'agents-trash-'));
  const proj = join(root, 'projects', 'p');
  mkdirSync(proj, { recursive: true });
  const trash = join(root, 'agents', 'trash');
  return { root, proj, trash, store: createTrashStore(trash) };
};

test('trash moves transcript and companion folder, newest first, replacing same id', async () => {
  const { proj, trash, store } = setup();
  writeFileSync(join(proj, 'a.jsonl'), 'A');
  mkdirSync(join(proj, 'a'));
  writeFileSync(join(proj, 'a', 'x.txt'), 'X');
  writeFileSync(join(proj, 'b.jsonl'), 'B');
  expect(await store.trash({ id: 'a', file: join(proj, 'a.jsonl'), title: 'One' }, 100)).toBe(true);
  await store.trash({ id: 'b', file: join(proj, 'b.jsonl') }, 200);
  expect(existsSync(join(proj, 'a.jsonl'))).toBe(false);
  expect(existsSync(join(proj, 'a'))).toBe(false);
  expect(readFileSync(join(trash, 'a', 'x.txt'), 'utf8')).toBe('X');
  const list = await store.list();
  expect(list.map((e) => e.id)).toEqual(['b', 'a']);
  expect(list[0]).toMatchObject({ agent: 'claude', title: '' });
  writeFileSync(join(proj, 'a.jsonl'), 'A2');
  await store.trash({ id: 'a', file: join(proj, 'a.jsonl'), title: 'Two' }, 300);
  const again = await store.list();
  expect(again.map((e) => e.id)).toEqual(['a', 'b']);
  expect(again[0]!.title).toBe('Two');
});

test('restore moves back, refuses overwrite and unknown ids', async () => {
  const { proj, trash, store } = setup();
  writeFileSync(join(proj, 'a.jsonl'), 'A');
  mkdirSync(join(proj, 'a'));
  writeFileSync(join(proj, 'a', 'x.txt'), 'X');
  await store.trash({ id: 'a', file: join(proj, 'a.jsonl') });
  writeFileSync(join(proj, 'a.jsonl'), 'NEW');
  expect(await store.restore('a')).toEqual({ ok: false, error: 'exists' });
  expect(readFileSync(join(proj, 'a.jsonl'), 'utf8')).toBe('NEW');
  expect(existsSync(join(trash, 'a.jsonl'))).toBe(true);
  await Bun.file(join(proj, 'a.jsonl')).delete();
  const r = await store.restore('a');
  expect(r.ok).toBe(true);
  expect(readFileSync(join(proj, 'a.jsonl'), 'utf8')).toBe('A');
  expect(readFileSync(join(proj, 'a', 'x.txt'), 'utf8')).toBe('X');
  expect(await store.list()).toEqual([]);
  expect(await store.restore('a')).toEqual({ ok: false, error: 'gone' });
  expect(await store.restore('../a')).toEqual({ ok: false, error: 'gone' });
});

test('manifest: damaged reads empty, bad entries ignored', async () => {
  const { trash, store } = setup();
  mkdirSync(trash, { recursive: true });
  writeFileSync(join(trash, 'manifest.json'), '{nope');
  expect(await store.list()).toEqual([]);
  writeFileSync(join(trash, 'manifest.json'), JSON.stringify([{ id: 'a', originalPath: '/x', trashedAt: 1 }, { originalPath: '/x', trashedAt: 1 }, { id: 'b', trashedAt: 1 }, { id: 'c', originalPath: '/x' }]));
  expect(await store.list()).toEqual([{ id: 'a', agent: 'claude', title: '', originalPath: '/x', trashedAt: 1 }]);
});

test('purge removes entries older than the retention, keeps unsafe ids', async () => {
  const { proj, trash, store } = setup();
  writeFileSync(join(proj, 'old.jsonl'), 'O');
  writeFileSync(join(proj, 'edge.jsonl'), 'E');
  writeFileSync(join(proj, 'new.jsonl'), 'N');
  const now = 100 * DAY_MS;
  await store.trash({ id: 'old', file: join(proj, 'old.jsonl') }, now - 31 * DAY_MS);
  await store.trash({ id: 'edge', file: join(proj, 'edge.jsonl') }, now - 30 * DAY_MS);
  await store.trash({ id: 'new', file: join(proj, 'new.jsonl') }, now - DAY_MS);
  const mf = JSON.parse(readFileSync(join(trash, 'manifest.json'), 'utf8'));
  mf.push({ id: '../evil', originalPath: '/x', trashedAt: 0 });
  writeFileSync(join(trash, 'manifest.json'), JSON.stringify(mf));
  expect(await store.purge(30, now)).toEqual(['old']);
  expect(existsSync(join(trash, 'old.jsonl'))).toBe(false);
  expect((await store.list()).map((e) => e.id).sort()).toEqual(['../evil', 'edge', 'new']);
});

test('isSafeId', () => {
  expect(isSafeId('0a1b-2c_d.e')).toBe(true);
  for (const id of ['', '..', 'a/b', 'a\\b', 'a..b', '.x', 5]) expect(isSafeId(id)).toBe(false);
});
