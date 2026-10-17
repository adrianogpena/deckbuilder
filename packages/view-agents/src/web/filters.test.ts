import { describe, expect, test } from 'bun:test';
import type { AgentSessionView, AgentStatus } from './api';
import { categoryOf, clearFilters, isFiltering, matchesFilters, NO_FILTERS, nextTime, parseQuery, timeCutoff, titleNote, toggleStatus, toggleTag } from './filters';

const H = 3_600_000;
const NOW = new Date(2026, 9, 17, 15, 0, 0).getTime();
const s = (status: AgentStatus, updatedAt = NOW, tags?: string[]) => ({ id: 'x', status, updatedAt, tags }) as AgentSessionView;

describe('filters', () => {
  test('maps statuses to categories', () => {
    expect(categoryOf(s('starting'))).toBe('running');
    expect(categoryOf(s('done'))).toBe('waiting');
    expect(categoryOf(s('exited'))).toBe('error');
    expect(categoryOf(s('stopped'))).toBe('stopped');
  });

  test('status set combines with OR, empty is no filter', () => {
    const f = toggleStatus(toggleStatus(NO_FILTERS, 'running'), 'error');
    expect(matchesFilters(s('running'), f, NOW)).toBe(true);
    expect(matchesFilters(s('exited'), f, NOW)).toBe(true);
    expect(matchesFilters(s('idle'), f, NOW)).toBe(false);
    expect(matchesFilters(s('idle'), toggleStatus(f, 'running'), NOW)).toBe(false);
    expect(matchesFilters(s('idle'), NO_FILTERS, NOW)).toBe(true);
  });

  test('time cycles and cuts on modification time', () => {
    const modes = [NO_FILTERS];
    for (let i = 0; i < 4; i++) modes.push(nextTime(modes[i]!));
    expect(modes.map((f) => f.time)).toEqual(['all', 'today', '3d', '7d', 'all']);
    expect(timeCutoff('today', NOW)).toBe(new Date(2026, 9, 17).getTime());
    expect(timeCutoff('3d', NOW)).toBe(NOW - 72 * H);
    const week = { ...NO_FILTERS, time: '7d' as const };
    expect(matchesFilters(s('idle', NOW - 168 * H), week, NOW)).toBe(true);
    expect(matchesFilters(s('idle', NOW - 168 * H - 1), week, NOW)).toBe(false);
  });

  test('tag toggles, is exact, and ANDs with status', () => {
    const f = toggleTag(NO_FILTERS, 'Bug');
    expect(toggleTag(f, 'Bug').tag).toBeUndefined();
    expect(toggleTag(f, 'ui').tag).toBe('ui');
    expect(matchesFilters(s('idle', NOW, ['bug']), f, NOW)).toBe(false);
    expect(matchesFilters(s('idle', NOW, ['Bug']), toggleStatus(f, 'running'), NOW)).toBe(false);
    expect(matchesFilters(s('running', NOW, ['Bug']), toggleStatus(f, 'running'), NOW)).toBe(true);
  });

  test('clear resets status, time and tag', () => {
    const f = nextTime(toggleTag(toggleStatus(NO_FILTERS, 'idle'), 'a'));
    expect(isFiltering(f)).toBe(true);
    expect(isFiltering(clearFilters())).toBe(false);
  });

  test('title note lists active modes in order', () => {
    const l = { selected: (n: number) => `${n} sel`, archived: 'arch', filtered: 'filt', actionable: 'act', activeOnTop: 'top' };
    expect(titleNote({}, l)).toBe('');
    expect(titleNote({ activeOnTop: true, filtered: true, selected: 2, archived: true, actionable: true }, l)).toBe('· 2 sel · arch · filt · act · top');
  });
});

describe('parseQuery', () => {
  test('plain, trimmed', () => {
    expect(parseQuery('  foo ')).toEqual({ full: false, status: undefined, needle: 'foo' });
    expect(parseQuery('')).toEqual({ full: false, status: undefined, needle: '' });
  });
  test('status prefix', () => {
    expect(parseQuery('@ foo')).toEqual({ full: false, status: 'waiting', needle: 'foo' });
    expect(parseQuery('!')).toEqual({ full: false, status: 'running', needle: '' });
    expect(parseQuery('~x').status).toBe('stopped');
    expect(parseQuery('a@').status).toBeUndefined();
  });
  test('full text with status in either order', () => {
    expect(parseQuery('?foo')).toEqual({ full: true, status: undefined, needle: 'foo' });
    expect(parseQuery('?&foo')).toEqual({ full: true, status: 'error', needle: 'foo' });
    expect(parseQuery('#?foo')).toEqual({ full: true, status: 'idle', needle: 'foo' });
  });
});
