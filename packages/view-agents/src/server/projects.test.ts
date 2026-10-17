import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectsStore } from './projects.ts';

test('add, dedupe, persist and remove', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'agents-proj-')), 'agents', 'projects.json');
  const s = createProjectsStore(file);
  expect(s.list()).toEqual([]);
  expect(s.add({ path: '' })).toBeNull();
  const a = s.add({ path: 'C:\\code\\app\\' })!;
  expect(a.name).toBe('app');
  expect(s.add({ path: 'c:/code/app' })!.id).toBe(a.id);
  expect(createProjectsStore(file).list()).toEqual([a]);
  expect(s.remove(a.id)).toBe(true);
  expect(s.remove(a.id)).toBe(false);
  expect(createProjectsStore(file).list()).toEqual([]);
});

test('remove hides, add un-hides, hidden persists', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'agents-proj-')), 'agents', 'projects.json');
  const s = createProjectsStore(file);
  const a = s.add({ path: 'C:/code/app' })!;
  expect(s.remove(a.id)).toBe(true);
  expect(s.list()).toEqual([]);
  expect(s.hidden()).toEqual(['c:/code/app']);
  expect(createProjectsStore(file).list()).toEqual([]);
  expect(s.add({ path: 'c:/code/APP' })).toEqual(a);
  expect(s.list()).toEqual([a]);
  expect(s.hidden()).toEqual([]);
});
