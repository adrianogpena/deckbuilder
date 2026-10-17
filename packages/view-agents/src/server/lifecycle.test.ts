import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLifecycle, cwdProblem, planRestart, stopOutcome, type TermInfo } from './lifecycle';
import type { PidEntry } from './status';

const term = (over: Partial<TermInfo> = {}): TermInfo => ({ id: 't1', sessionId: 'a', account: 'acc', cwd: 'C:\\x', ...over });
const pid = (sessionId: string, p = 100): PidEntry => ({ pid: p, sessionId });

test('starting lasts until the pid file of the session appears', () => {
  const l = createLifecycle();
  expect([...l.poll([term()], []).starting]).toEqual(['a']);
  expect(l.poll([term()], [pid('a')]).starting.size).toBe(0);
});

test('a differing session id in the bound pid file is adopted once (/clear)', () => {
  const l = createLifecycle();
  l.poll([term()], [pid('a')]);
  const r = l.poll([term()], [pid('b')]);
  expect(r.adopt).toEqual([{ terminal: 't1', from: 'a', to: 'b' }]);
  expect(r.starting.size).toBe(0);
  expect(l.poll([term({ sessionId: 'b' })], [pid('b')]).adopt).toEqual([]);
});

test('before the bind, another process id does not count as a clear; other terminals pids are not stolen', () => {
  const l = createLifecycle();
  expect(l.poll([term()], [pid('z', 7)]).adopt).toEqual([]);
  l.poll([term()], [pid('a', 100)]);
  const r = l.poll([term(), term({ id: 't2' })], [pid('a', 100)]);
  expect([...r.starting]).toEqual(['a']);
  expect(r.adopt).toEqual([]);
});

test('exited terminals report their code and are not starting', () => {
  const l = createLifecycle();
  const r = l.poll([term({ exited: 0 }), term({ id: 't2', sessionId: 'c', exited: null })], []);
  expect(r.exited).toEqual(new Map<string, number | null>([['a', 0], ['c', null]]));
  expect(r.starting.size).toBe(0);
});

test('a removed terminal is forgotten and binds again when restarted', () => {
  const l = createLifecycle();
  l.poll([term()], [pid('a')]);
  l.poll([], []);
  expect([...l.poll([term()], []).starting]).toEqual(['a']);
});

test('cwd check', () => {
  expect(cwdProblem(tmpdir())).toBeUndefined();
  const gone = join(tmpdir(), 'deckbuilder-no-such-folder-xyz');
  expect(cwdProblem(gone)).toEqual({ error: 'cwdMissing', cwd: gone });
});

test('restart resumes with a transcript, else drops the id, and refuses external sessions', () => {
  const base = { known: true, external: false, sessionId: 'a', hasTranscript: true };
  expect(planRestart(base)).toEqual({ ok: true, sessionId: 'a', resume: true });
  expect(planRestart({ ...base, hasTranscript: false }, () => 'new')).toEqual({ ok: true, sessionId: 'new', resume: false });
  expect(planRestart({ ...base, external: true })).toEqual({ ok: false, error: 'external' });
  expect(planRestart({ ...base, known: false })).toEqual({ ok: false, error: 'unknownSession' });
});

test('stop removes only a session without a transcript', () => {
  expect(stopOutcome(true)).toEqual({ removed: false });
  expect(stopOutcome(false)).toEqual({ removed: true });
});
