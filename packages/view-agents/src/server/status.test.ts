import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStatusTracker, pickStatus, readPidFiles } from './status';

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

test('baseline, running to idle becomes done until seen', () => {
  const t = createStatusTracker();
  const e = (status: string) => [{ pid: 1, sessionId: 'a', status }];
  expect(t.update(e('idle')).get('a')).toBe('idle');
  expect(t.update(e('busy')).get('a')).toBe('running');
  expect(t.update(e('idle')).get('a')).toBe('done');
  expect(t.update(e('idle')).get('a')).toBe('done');
  t.markSeen('a');
  expect(t.update(e('idle')).get('a')).toBe('idle');
  expect(t.update(e('waiting')).get('a')).toBe('needs-you');
  expect(t.update([]).has('a')).toBe(false);
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
