import { expect, test } from 'bun:test';
import type { Runner, RunResult } from '../run.ts';
import { autostartArgv, createAutostart, parseRegQuery } from './autostart.ts';

const EXE = 'C:\\Apps\\Gallery\\gallery.exe';
const done = (stdout = '', code = 0): RunResult => ({ kind: 'done', code, stdout, stderr: '' });

function setup(respond: (cmd: string[]) => RunResult, enabled = true, args: string[] = []) {
  const calls: string[][] = [];
  const run: Runner = async (cmd) => {
    calls.push(cmd);
    return respond(cmd);
  };
  return { calls, autostart: createAutostart({ name: 'My Gallery', args, run, execPath: EXE, enabled, onWarn: () => {} }) };
}

const query = (data: string) => `\r\nHKEY_CURRENT_USER\\Software\\Run\r\n    My Gallery    REG_SZ    ${data}\r\n`;

test('enable adds the Run value with the exe and its args', async () => {
  const { autostart, calls } = setup(() => done(), true, ['--browser', '--no-open']);
  await autostart.set(true);
  expect(calls).toEqual([autostartArgv('My Gallery', true, `"${EXE}" --browser --no-open`)]);
  expect(calls[0]?.slice(0, 5)).toEqual(['reg.exe', 'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'My Gallery']);
});

test('disable deletes the value only when it exists', async () => {
  const absent = setup(() => done('', 1));
  await absent.autostart.set(false);
  expect(absent.calls.map((c) => c[1])).toEqual(['query']);

  const present = setup((cmd) => (cmd[1] === 'query' ? done(query(`"${EXE}"`)) : done()));
  await present.autostart.set(false);
  expect(present.calls.map((c) => c[1])).toEqual(['query', 'delete']);
});

test('when not enabled (source run, not Windows) the registry is never touched', async () => {
  const { autostart, calls } = setup(() => done(), false);
  await autostart.set(true);
  await autostart.fixUp();
  expect(calls).toEqual([]);
});

test('fixUp registers a missing value, rewrites a moved path and leaves a current one', async () => {
  const moved = setup((cmd) => (cmd[1] === 'query' ? done(query('"D:\\old\\gallery.exe"')) : done()));
  await moved.autostart.fixUp();
  expect(moved.calls.map((c) => c[1])).toEqual(['query', 'add']);

  const current = setup(() => done(query(`"${EXE}"`)));
  await current.autostart.fixUp();
  expect(current.calls.map((c) => c[1])).toEqual(['query']);

  const none = setup(() => done('', 1));
  await none.autostart.fixUp();
  expect(none.calls.map((c) => c[1])).toEqual(['query', 'add']);
});

test('parseRegQuery reads the value data of the named value only', () => {
  expect(parseRegQuery(query('"C:\\a b\\d.exe" --x'), 'My Gallery')).toBe('"C:\\a b\\d.exe" --x');
  expect(parseRegQuery(query('x'), 'Gallery')).toBeNull();
  expect(parseRegQuery('', 'My Gallery')).toBeNull();
});
