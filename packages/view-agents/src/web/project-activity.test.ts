import { describe, expect, test } from 'bun:test';
import type { AgentSessionView } from '../protocol';
import { activityStatus, avatarColour, avatarInitial, failedExit, projectActivity, sessionActivity } from './project-activity';

const s = (status: AgentSessionView['status'], extra: Partial<AgentSessionView> = {}) => ({ status, ...extra }) as AgentSessionView;

describe('projectActivity', () => {
  test('empty list is none', () => {
    expect(projectActivity([])).toBe('none');
  });

  test('priority attention > error > working > running > idle', () => {
    expect(projectActivity([s('idle'), s('running'), s('error'), s('needs-you')])).toBe('attention');
    expect(projectActivity([s('idle'), s('running'), s('error')])).toBe('error');
    expect(projectActivity([s('done'), s('starting'), s('idle')])).toBe('working');
    expect(projectActivity([s('idle'), s('done')])).toBe('running');
    expect(projectActivity([s('stopped'), s('idle')])).toBe('idle');
  });

  test('a live idle session counts as running', () => {
    expect(sessionActivity(s('idle', { live: true }))).toBe('running');
  });

  test('stop exit codes are not failures', () => {
    for (const code of [130, 143, 3221225786, 0, null]) expect(sessionActivity(s('exited', { exitCode: code }))).toBe('idle');
    expect(sessionActivity(s('exited', { exitCode: 1 }))).toBe('error');
    expect(failedExit(2)).toBe(true);
    expect(failedExit(undefined)).toBe(false);
  });

  test('activity maps to a dot status', () => {
    expect(activityStatus('attention')).toBe('needs-you');
    expect(activityStatus('working')).toBe('running');
    expect(activityStatus('running')).toBe('done');
    expect(activityStatus('none')).toBe('none');
  });
});

describe('avatar', () => {
  test('colour is stable and in range, insensitive to case and slashes', () => {
    const a = avatarColour('C:\\Users\\me\\proj');
    expect(a).toBe(avatarColour('c:/users/me/proj/'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(10);
  });

  test('initial is the first letter or digit', () => {
    expect(avatarInitial('deckbuilder')).toBe('D');
    expect(avatarInitial('_9lives')).toBe('9');
    expect(avatarInitial('--')).toBe('?');
  });
});
