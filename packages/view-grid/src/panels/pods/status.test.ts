import { describe, expect, test } from 'bun:test';
import { containerState, podStatus, readyCount, readyTone, restarts, restartsTone } from './status';

const running = (ready: boolean[]) => ({
  spec: { containers: ready.map(() => ({})) },
  status: { phase: 'Running', containerStatuses: ready.map((r) => ({ ready: r, restartCount: 1, state: { running: {} } })) },
});

describe('podStatus', () => {
  test('running all ready is ok', () => {
    expect(podStatus(running([true, true]))).toEqual({ text: 'Running', tone: 'ok' });
  });
  test('running not all ready is warn', () => {
    expect(podStatus(running([true, false]))).toEqual({ text: 'Running', tone: 'warn' });
  });
  test('waiting reason errors', () => {
    const pod = { status: { phase: 'Running', containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } } }] } };
    expect(podStatus(pod)).toEqual({ text: 'CrashLoopBackOff', tone: 'err' });
  });
  test('completed is muted', () => {
    const pod = { status: { phase: 'Succeeded', containerStatuses: [{ state: { terminated: { reason: 'Completed', exitCode: 0 } } }] } };
    expect(podStatus(pod)).toEqual({ text: 'Completed', tone: 'muted' });
  });
  test('init and terminating are warn', () => {
    const init = { status: { phase: 'Pending', initContainerStatuses: [{ state: { waiting: { reason: 'PodInitializing' } } }] } };
    expect(podStatus(init)).toEqual({ text: 'Init:0/1', tone: 'warn' });
    expect(podStatus({ ...running([true]), metadata: { deletionTimestamp: 'x' } })).toEqual({ text: 'Terminating', tone: 'warn' });
  });
  test('unknown phase is info', () => {
    expect(podStatus({ status: { phase: 'Odd' } })).toEqual({ text: 'Odd', tone: 'info' });
  });
});

describe('counts and tones', () => {
  test('readyCount and restarts', () => {
    expect(readyCount(running([true, false]))).toEqual([1, 2]);
    expect(restarts(running([true, false]))).toBe(2);
  });
  test('readyTone', () => {
    expect(readyTone(2, 2)).toBe('ok');
    expect(readyTone(0, 2)).toBe('err');
    expect(readyTone(1, 2)).toBe('warn');
  });
  test('restartsTone', () => {
    expect(restartsTone(0)).toBe('muted');
    expect(restartsTone(3)).toBe('warn');
    expect(restartsTone(6)).toBe('err');
  });
  test('containerState', () => {
    expect(containerState({ ready: true, state: { running: {} } }).tone).toBe('ok');
    expect(containerState({ ready: false, state: { running: {} } }).tone).toBe('warn');
    expect(containerState({ state: { waiting: { reason: 'X' } } }).tone).toBe('warn');
    expect(containerState({ state: { terminated: { exitCode: 0 } } }).tone).toBe('muted');
    expect(containerState({ state: { terminated: { exitCode: 1 } } }).tone).toBe('err');
  });
});
