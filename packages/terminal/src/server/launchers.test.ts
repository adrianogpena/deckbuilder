import { describe, expect, test } from 'bun:test';
import { isUuid, type Launcher, launchers } from './launchers.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const ctx = { shell: ['/bin/bash', '-l'] };

const claude: Launcher<{ resume?: string }> = {
  label: 'Claude',
  parse(args) {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
    const keys = Object.keys(args);
    if (keys.some((k) => k !== 'resume')) return null;
    const { resume } = args as { resume?: unknown };
    if (resume === undefined) return {};
    return isUuid(resume) ? { resume } : null;
  },
  command: (a) => (a.resume ? ['claude', '--resume', a.resume] : ['claude']),
  env: () => ({ CLAUDE_CODE: '1' }),
  meta: (a) => ({ resume: a.resume ?? null }),
};

const make = () =>
  launchers({
    claude,
    gone: { label: 'Gone', parse: () => ({}), command: () => ['gone'], available: () => false },
    garbage: { label: 'Garbage', parse: () => ({}), command: () => [1, 2] as unknown as string[] },
    empty: { label: 'Empty', parse: () => ({}), command: () => [] },
    shelly: { label: 'Shell', parse: () => ({}), command: (_a, c) => c.shell },
  });

describe('isUuid', () => {
  test('accepts canonical uuids only', () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
    expect(isUuid(UUID.replaceAll('-', ''))).toBe(false);
    expect(isUuid(`${UUID} `)).toBe(false);
    expect(isUuid(`{${UUID}}`)).toBe(false);
    expect(isUuid(1)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('launchers', () => {
  const l = make();

  test('valid args build the argv', () => {
    expect(l.resolve('claude', { resume: UUID }, ctx)?.cmd).toEqual(['claude', '--resume', UUID]);
    expect(l.resolve('claude', {}, ctx)?.cmd).toEqual(['claude']);
  });

  test('passes env, meta, label and launcher through', () => {
    expect(l.resolve('claude', { resume: UUID }, ctx)).toEqual({
      cmd: ['claude', '--resume', UUID],
      env: { CLAUDE_CODE: '1' },
      label: 'Claude',
      meta: { resume: UUID },
      launcher: 'claude',
    });
    expect(l.resolve('shelly', {}, ctx)).toEqual({ cmd: ['/bin/bash', '-l'], env: {}, label: 'Shell', meta: {}, launcher: 'shelly' });
  });

  test('rejects invalid args', () => {
    expect(l.resolve('claude', { resume: '; rm -rf /' }, ctx)).toBeNull();
    expect(l.resolve('claude', { resume: '--dangerously-skip-permissions' }, ctx)).toBeNull();
    expect(l.resolve('claude', { resume: UUID, extra: 1 }, ctx)).toBeNull();
    expect(l.resolve('claude', '; rm -rf /', ctx)).toBeNull();
    expect(l.resolve('claude', null, ctx)).toBeNull();
    expect(l.resolve('claude', [UUID], ctx)).toBeNull();
  });

  test('rejects unknown and malformed ids', () => {
    expect(l.resolve('nope', {}, ctx)).toBeNull();
    expect(l.resolve('__proto__', {}, ctx)).toBeNull();
    expect(l.resolve('constructor', {}, ctx)).toBeNull();
    expect(l.resolve('tostring', {}, ctx)).toBeNull();
    expect(l.resolve('toString', {}, ctx)).toBeNull();
    expect(l.resolve('Claude', {}, ctx)).toBeNull();
    expect(l.resolve(1, {}, ctx)).toBeNull();
    expect(l.resolve(undefined, {}, ctx)).toBeNull();
    expect(l.resolve(['claude'], {}, ctx)).toBeNull();
  });

  test('unavailable launchers do not resolve', () => {
    expect(l.resolve('gone', {}, ctx)).toBeNull();
  });

  test('a command that is not a non-empty string array is null', () => {
    expect(l.resolve('garbage', {}, ctx)).toBeNull();
    expect(l.resolve('empty', {}, ctx)).toBeNull();
  });

  test('list excludes unavailable launchers', () => {
    expect(l.list()).toEqual([
      { id: 'claude', label: 'Claude' },
      { id: 'garbage', label: 'Garbage' },
      { id: 'empty', label: 'Empty' },
      { id: 'shelly', label: 'Shell' },
    ]);
  });

  test('a bad registered id throws', () => {
    expect(() => launchers({ Claude: claude })).toThrow();
    expect(() => launchers({ '1claude': claude })).toThrow();
    expect(() => launchers({ 'my launcher': claude })).toThrow();
    expect(() => launchers({ ['a'.repeat(33)]: claude })).toThrow();
  });
});
