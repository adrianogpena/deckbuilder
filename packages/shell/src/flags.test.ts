import { describe, expect, test } from 'bun:test';
import { type Flags, parseFlags } from './flags.ts';

const parse = (...argv: string[]): Flags => {
  const flags = parseFlags(argv);
  if ('error' in flags) throw new Error(flags.error);
  return flags;
};

describe('parseFlags', () => {
  test('defaults to a native window', () => {
    expect(parse()).toEqual({
      mode: 'window',
      noOpen: false,
      port: undefined,
      idleExitMinutes: undefined,
      dev: false,
      help: false,
      openUrl: undefined,
      afterUpdate: false,
      window: false,
    });
  });

  test('--app and --browser pick the mode; --no-open opens nothing', () => {
    expect(parse('--app').mode).toBe('app');
    expect(parse('--browser').mode).toBe('browser');
    expect(parse('--browser', '--no-open')).toMatchObject({ mode: 'none', noOpen: true });
    expect(parse('--app', '--no-open').mode).toBe('none');
  });

  test('--dev opens nothing unless --window, --app or --browser', () => {
    expect(parse('--dev')).toMatchObject({ mode: 'none', dev: true });
    expect(parse('--dev', '--window')).toMatchObject({ mode: 'window', window: true });
    expect(parse('--dev', '--app').mode).toBe('app');
  });

  test('--open-url opens a window', () => {
    expect(parse('--browser', '--open-url', 'gallery://open/settings')).toMatchObject({ mode: 'window', openUrl: 'gallery://open/settings' });
  });

  test('--open-url ignores every other flag', () => {
    expect(parse('--open-url', 'gallery://open/x', '--dev', '--browser', '--port', 'abc')).toEqual({
      ...parse(),
      openUrl: 'gallery://open/x',
    });
  });

  test('--port', () => {
    expect(parse('--port', '7791').port).toBe(7791);
    expect(parse('--port', '0').port).toBe(0);
  });

  test('--idle-exit', () => {
    expect(parse('--idle-exit', '0.5').idleExitMinutes).toBe(0.5);
    expect(parseFlags(['--idle-exit', '0'])).toHaveProperty('error');
    expect(parseFlags(['--idle-exit'])).toHaveProperty('error');
  });

  test('--help, -h and --after-update', () => {
    expect(parse('--help').help).toBe(true);
    expect(parse('-h').help).toBe(true);
    expect(parse('--after-update').afterUpdate).toBe(true);
  });

  test('rejects a bad port', () => {
    expect(parseFlags(['--port', 'abc'])).toHaveProperty('error');
    expect(parseFlags(['--port', '70000'])).toHaveProperty('error');
    expect(parseFlags(['--port', '-1'])).toHaveProperty('error');
    expect(parseFlags(['--port'])).toHaveProperty('error');
  });
});
