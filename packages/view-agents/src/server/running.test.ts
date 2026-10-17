import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('the next run sees the sessions the last one left, minus the live ones', () => {
  const f = file();
  const a = createRunningStore(f);
  a.sync([
    { id: 's1', account: 'a', mode: 'terminal' },
    { id: 's2', account: 'a', mode: 'chat', project: 'p' },
  ]);
  const b = createRunningStore(f);
  expect(b.recovery([]).map((r) => r.id)).toEqual(['s1', 's2']);
  expect(b.recovery(['s1']).map((r) => r.id)).toEqual(['s2']);
  b.sync([]);
  expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([]);
  expect(b.recovery([]).length).toBe(2);
  b.dismiss();
  expect(b.recovery([])).toEqual([]);
});

test('a missing or malformed file gives no recovery', () => {
  const f = file();
  expect(createRunningStore(f).recovery([])).toEqual([]);
  const s = createRunningStore(f);
  s.sync([{ id: 'x', account: 'a', mode: 'chat' }]);
  writeFileSync(f, '{bad');
  expect(createRunningStore(f).recovery([])).toEqual([]);
});
