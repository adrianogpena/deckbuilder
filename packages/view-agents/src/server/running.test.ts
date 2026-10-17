import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunningStore } from './running.ts';

const dirs: string[] = [];
const file = () => {
  const d = mkdtempSync(join(tmpdir(), 'running-'));
  dirs.push(d);
  return join(d, 'agents', 'running.json');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const all = () => true;
const two = [
  { id: 's1', account: 'a', mode: 'terminal' as const },
  { id: 's2', account: 'a', mode: 'chat' as const, project: 'p' },
];

test('the next run restores what the last one left, minus the live ones', () => {
  const f = file();
  const a = createRunningStore(f, { pid: 1 });
  a.decide('ask', [], all);
  a.sync(two);
  expect(JSON.parse(readFileSync(f, 'utf8')).pid).toBe(1);
  const b = createRunningStore(f, { pid: 2, alive: () => false });
  b.decide('ask', [], all);
  expect(b.recovery([]).map((r) => r.id)).toEqual(['s1', 's2']);
  expect(b.recovery(['s1']).map((r) => r.id)).toEqual(['s2']);
  b.sync([]);
  expect(JSON.parse(readFileSync(f, 'utf8')).sessions.map((r: { id: string }) => r.id)).toEqual(['s1', 's2']);
  b.dismiss();
  expect(b.recovery([])).toEqual([]);
  b.sync([]);
  expect(JSON.parse(readFileSync(f, 'utf8')).sessions).toEqual([]);
});

test('nothing is written before the decision or while quitting', () => {
  const f = file();
  const s = createRunningStore(f, { pid: 1 });
  s.sync(two);
  expect(() => readFileSync(f, 'utf8')).toThrow();
  s.decide('ask', [], all);
  s.setQuitting();
  s.sync(two);
  expect(() => readFileSync(f, 'utf8')).toThrow();
});

test('the restore is skipped for never, a live other instance, live sessions or no match', () => {
  const f = file();
  const a = createRunningStore(f, { pid: 1 });
  a.decide('ask', [], all);
  a.sync(two);
  const skip = (policy: 'ask' | 'never', alive: boolean, live: string[], listed: () => boolean) => {
    const s = createRunningStore(f, { pid: 2, alive: () => alive });
    s.decide(policy, live, listed);
    return s.recovery([]);
  };
  expect(skip('never', false, [], all)).toEqual([]);
  expect(skip('ask', true, [], all)).toEqual([]);
  expect(skip('ask', false, ['x'], all)).toEqual([]);
  expect(skip('ask', false, [], () => false)).toEqual([]);
  expect(skip('ask', false, [], all).length).toBe(2);
});

test('a missing or malformed file gives no recovery', () => {
  const f = file();
  const s0 = createRunningStore(f);
  s0.decide('ask', [], all);
  expect(s0.recovery([])).toEqual([]);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, '{bad');
  const s = createRunningStore(f);
  s.decide('ask', [], all);
  expect(s.recovery([])).toEqual([]);
});
