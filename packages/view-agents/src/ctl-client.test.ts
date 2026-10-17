import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCtlArgs, runCtl } from './ctl-client.ts';
import { ctlFile, type CtlServer, type CtlSession, startCtlServer } from './server/ctl-server.ts';

const session = (id: string, status: string): CtlSession => ({ id, agent: 'claude', title: `t-${id}`, project: 'proj', status, live: true, cwd: '/x', updatedAt: '2026-01-01T00:00:00Z' });

let dir: string;
let server: CtlServer | undefined;
let sessions: CtlSession[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctl-client-'));
  sessions = [session('abc123', 'running'), session('def456', 'done')];
});
afterEach(() => {
  server?.stop();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const start = () => {
  server = startCtlServer({
    dir,
    deps: { version: '1', pid: process.pid, list: () => sessions, screenLines: (_id, n) => ['one  ', 'two', 'three', '', ''].slice(0, n) },
  });
};

async function run(args: string[], extra: Partial<Parameters<typeof runCtl>[1]> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCtl(args, { dir, stdout: (s) => out.push(s), stderr: (s) => err.push(s), pollMs: 20, ...extra });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('parseCtlArgs', () => {
  test('accepts commands and options', () => {
    expect(parseCtlArgs(['wait', 'abc', '--status', 'done,error', '--timeout', '1.5', '--json'])).toMatchObject({ command: 'wait', id: 'abc', status: ['done', 'error'], timeout: 1.5, json: true });
    expect(parseCtlArgs(['screen', 'abc', '--rows', '3'])).toMatchObject({ rows: 3 });
  });
  test('rejects bad input', () => {
    for (const a of [[], ['nope'], ['status'], ['list', 'x'], ['list', '--bogus'], ['wait', 'a'], ['wait', 'a', '--status', 'bad'], ['wait', 'a', '--status', 'done', '--timeout', '-1'], ['screen', 'a', '--rows'], ['screen', 'a', '--rows', 'x']]) {
      expect('error' in parseCtlArgs(a)).toBe(true);
    }
  });
});

describe('runCtl', () => {
  test('list, status, screen, ping', async () => {
    start();
    const list = await run(['list']);
    expect(list.code).toBe(0);
    expect(list.out.split('\n')[0]).toMatch(/^abc123\s+running\s+claude\s+proj\s+t-abc123$/);
    expect(JSON.parse((await run(['list', '--json'])).out).sessions).toHaveLength(2);
    expect((await run(['status', 'abc'])).out).toContain('status: running');
    expect((await run(['screen', 'abc', '--rows', '2'])).out).toBe('two\nthree');
    expect(JSON.parse((await run(['ping'])).out).pid).toBe(process.pid);
  });

  test('server errors and bad arguments exit 1', async () => {
    start();
    expect((await run(['status', 'zzz'])).code).toBe(1);
    expect((await run(['nope'])).code).toBe(1);
  });

  test('wait matches, polls and times out', async () => {
    start();
    expect(await run(['wait', 'def', '--status', 'done'])).toMatchObject({ code: 0, out: 'done' });
    expect((await run(['wait', 'abc', '--status', 'done', '--timeout', '0'])).code).toBe(3);
    setTimeout(() => (sessions[0]!.status = 'waiting'), 80);
    expect(await run(['wait', 'abc', '--status', 'waiting', '--timeout', '3'])).toMatchObject({ code: 0, out: 'waiting' });
    expect((await run(['wait', 'abc', '--status', 'error', '--timeout', '0.1'])).code).toBe(3);
  });

  test('missing file exits 2 and mentions the setting when off', async () => {
    const r = await run(['list'], { enabled: () => false });
    expect(r.code).toBe(2);
    expect(r.err).toContain('ctl');
  });

  test('stale file is deleted', async () => {
    start();
    const ep = JSON.parse(readFileSync(ctlFile(dir), 'utf8'));
    server!.stop();
    server = undefined;
    writeFileSync(ctlFile(dir), JSON.stringify(ep));
    expect((await run(['ping'])).code).toBe(2);
    expect(existsSync(ctlFile(dir))).toBe(false);
  });
});
