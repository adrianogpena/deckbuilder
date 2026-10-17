import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStatusTracker, externalIds, pickStatus, readPidFiles } from './status';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('reads pid files, ignores key files and dead pids', () => {
  dir = mkdtempSync(join(tmpdir(), 'st-'));
  const s = join(dir, 'sessions');
  mkdirSync(s);
  writeFileSync(join(s, '100.json'), JSON.stringify({ pid: 100, sessionId: 'a', cwd: 'C:\\x', status: 'busy' }));
  writeFileSync(join(s, '200.json'), JSON.stringify({ pid: 200, sessionId: 'b', status: 'idle' }));
  writeFileSync(join(s, '100.abc.key'), 'secret');
  const out = readPidFiles(dir, (pid) => pid === 100);
  expect(out).toEqual([{ pid: 100, sessionId: 'a', cwd: 'C:\\x', status: 'busy', updatedAt: undefined }]);
});

test('baseline, running to idle becomes done until its stamp is seen', () => {
  let clock = 100;
  const t = createStatusTracker(() => ++clock);
  const e = (status: string) => [{ pid: 1, sessionId: 'a', status }];
  const seen: Record<string, number> = {};
  const u = (status: string) => t.update(e(status), undefined, { seen }).get('a');
  expect(u('idle')).toBe('idle');
  expect(u('busy')).toBe('running');
  expect(u('idle')).toBe('done');
  expect(u('idle')).toBe('done');
  seen.a = t.stamp('a')!;
  expect(u('idle')).toBe('idle');
  expect(u('busy')).toBe('running');
  expect(u('idle')).toBe('done');
  expect(u('waiting')).toBe('needs-you');
  expect(t.update([]).has('a')).toBe(false);
});

test('offline: unseen done -> done, unseen error -> exited, else stopped; forceDone makes it unread', () => {
  const t = createStatusTracker();
  const e = (status: string) => [{ pid: 1, sessionId: 'a', status }];
  t.update(e('busy'));
  t.update(e('idle'));
  t.update([]);
  expect(t.offline('a', {})).toBe('done');
  expect(t.offline('a', { a: t.stamp('a')! })).toBe('stopped');
  t.forceDone('b');
  expect(t.offline('b', {})).toBe('done');
  const err = new Map([['c', 'boom']]);
  t.update([{ pid: 2, sessionId: 'c', status: 'idle' }], err);
  t.update([]);
  expect(t.offline('c', {})).toBe('exited');
});

test('lifecycle sets: starting without a record, exited wins', () => {
  const t = createStatusTracker();
  const out = t.update([{ pid: 1, sessionId: 'x', status: 'busy' }], undefined, { starting: ['s'], exited: ['x'] });
  expect(out.get('s')).toBe('starting');
  expect(out.get('x')).toBe('exited');
});

test('a process starting busy is a baseline running, not done', () => {
  const t = createStatusTracker();
  expect(t.update([{ pid: 1, sessionId: 'a', status: 'shell' }]).get('a')).toBe('running');
});

test('precedence', () => {
  expect(pickStatus(['idle', 'done', 'running'])).toBe('running');
  expect(pickStatus(['idle', 'needs-you', 'error'])).toBe('error');
  expect(pickStatus([])).toBe('stopped');
});

test('screen error latches until the session runs again, then clears', () => {
  const t = createStatusTracker();
  const e = (status: string) => [{ pid: 1, sessionId: 'a', status }];
  const err = new Map([['a', 'Please run /login']]);
  expect(t.update(e('idle'), err).get('a')).toBe('error');
  expect(t.update(e('idle')).get('a')).toBe('error');
  expect(t.update(e('busy'), err).get('a')).toBe('running');
  expect(t.update(e('idle'), err).get('a')).not.toBe('error');
  expect(t.update(e('idle')).get('a')).not.toBe('error');
});

test('live pid sessions that are not ours are external', () => {
  const entries = [
    { pid: 1, sessionId: 'a' },
    { pid: 2, sessionId: 'b' },
    { pid: 3, sessionId: 'c' },
  ];
  expect([...externalIds(entries, ['a'])].sort()).toEqual(['b', 'c']);
  expect(externalIds(entries, ['a', 'b', 'c']).size).toBe(0);
});
