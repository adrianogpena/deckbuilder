import { expect, test } from 'bun:test';
import type { Runner, RunResult } from '../run.ts';
import { createUrlProtocol, parseFirstRegSz, protocolArgv } from './protocol.ts';

const EXE = 'C:\\Program Files\\Gallery\\gallery.exe';
const KEY = 'HKCU\\Software\\Classes\\gallery';
const done = (stdout = '', code = 0): RunResult => ({ kind: 'done', code, stdout, stderr: '' });

function setup(respond: (cmd: string[]) => RunResult, enabled = true) {
  const calls: string[][] = [];
  const run: Runner = async (cmd) => {
    calls.push(cmd);
    return respond(cmd);
  };
  return { calls, protocol: createUrlProtocol({ scheme: 'gallery', name: 'Gallery', run, execPath: EXE, enabled, onWarn: () => {} }) };
}

const query = (data: string, name = '(Default)') => `\r\n${KEY}\\shell\\open\\command\r\n    ${name}    REG_SZ    ${data}\r\n`;

test('register writes every key, quoting the exe path', async () => {
  const { protocol, calls } = setup(() => done());
  await protocol.register();
  expect(calls).toEqual([
    ['reg.exe', 'add', KEY, '/ve', '/d', 'URL:Gallery', '/f'],
    ['reg.exe', 'add', KEY, '/v', 'URL Protocol', '/d', '', '/f'],
    ['reg.exe', 'add', `${KEY}\\DefaultIcon`, '/ve', '/d', `"${EXE}",0`, '/f'],
    ['reg.exe', 'add', `${KEY}\\shell\\open\\command`, '/ve', '/d', `"${EXE}" --open-url "%1"`, '/f'],
  ]);
  expect(protocolArgv('gallery', 'Gallery', EXE)).toEqual(calls);
});

test('when not enabled the registry is never touched', async () => {
  const { protocol, calls } = setup(() => done(), false);
  await protocol.register();
  await protocol.fixUp();
  expect(calls).toEqual([]);
});

test('fixUp registers when absent or moved and leaves a current command', async () => {
  const none = setup((cmd) => (cmd[1] === 'query' ? done('', 1) : done()));
  await none.protocol.fixUp();
  expect(none.calls.map((c) => c[1])).toEqual(['query', 'add', 'add', 'add', 'add']);

  const moved = setup((cmd) => (cmd[1] === 'query' ? done(query('"D:\\old\\gallery.exe" --open-url "%1"')) : done()));
  await moved.protocol.fixUp();
  expect(moved.calls.map((c) => c[1])).toEqual(['query', 'add', 'add', 'add', 'add']);

  const current = setup(() => done(query(`"${EXE}" --open-url "%1"`, '(Standard)')));
  await current.protocol.fixUp();
  expect(current.calls.map((c) => c[1])).toEqual(['query']);
});

test('parseFirstRegSz reads the default value whatever its localized name', () => {
  expect(parseFirstRegSz(query('"C:\\a b\\app.exe" --open-url "%1"', '(valor padrão)'))).toBe('"C:\\a b\\app.exe" --open-url "%1"');
  expect(parseFirstRegSz('')).toBeNull();
});
