import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSessionView, AgentStatus } from '../protocol.ts';
import { ALERTS_KEEP, createAlerts } from './alerts.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'alerts-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sess = (id: string, status: AgentStatus) => ({ id, status, title: `T${id}`, name: '', firstPrompt: '', project: 'p1', cwd: '/x' }) as unknown as AgentSessionView;

test('first poll is a baseline, transitions are logged newest first', () => {
  const dir = tmp();
  let clock = 1000;
  const a = createAlerts(() => dir, undefined, () => clock++);
  a.observe([sess('a', 'running')]);
  expect(a.list()).toEqual([]);
  a.observe([sess('a', 'needs-you')]);
  a.observe([sess('a', 'done')]);
  const l = a.list();
  expect(l.map((x) => x.status)).toEqual(['done', 'needs-you']);
  expect(l[0]).toMatchObject({ id: 'a', label: 'Ta', project: 'p1' });
});

test('same transition is not written twice', () => {
  const dir = tmp();
  const a = createAlerts(() => dir);
  a.observe([sess('a', 'running')]);
  a.observe([sess('a', 'done')]);
  const b = createAlerts(() => dir);
  b.observe([sess('a', 'running')]);
  b.observe([sess('a', 'done')]);
  expect(a.list()).toHaveLength(1);
});

test('keeps the newest entries only', () => {
  const dir = tmp();
  let clock = 1;
  const a = createAlerts(() => dir, undefined, () => clock++);
  let s: AgentStatus = 'running';
  a.observe([sess('a', s)]);
  for (let i = 0; i < ALERTS_KEEP + 10; i++) {
    s = s === 'running' ? 'done' : 'running';
    a.observe([sess('a', s)]);
  }
  expect(readdirSync(dir)).toHaveLength(ALERTS_KEEP);
  expect(a.list()[0]!.timestamp).toBe(ALERTS_KEEP + 10);
});
