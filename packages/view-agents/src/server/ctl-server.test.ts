import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CtlDeps, type CtlServer, ctlFile, matchSessionId, startCtlServer, trimScreen } from './ctl-server.ts';

const sess = (id: string) => ({ id, agent: 'claude', title: 't', project: 'p', status: 'running', live: true, cwd: '/x', updatedAt: '2026-01-01T00:00:00.000Z' });
const deps = (over: Partial<CtlDeps> = {}): CtlDeps => ({ version: '1.2.3', pid: 42, list: () => [sess('abc123'), sess('abd456')], screenLines: (id) => (id === 'abc123' ? ['one  ', 'two', '', ''] : undefined), ...over });

const dirs: string[] = [];
const servers: CtlServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const boot = (over: Partial<CtlDeps> = {}, extra: { answerMs?: number; idleMs?: number } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ctl-'));
  dirs.push(dir);
  const s = startCtlServer({ dir, deps: deps(over), ...extra });
  servers.push(s);
  return { dir, s };
};

const talk = (port: number, lines: string[], n: number): Promise<any[]> =>
  new Promise((resolve) => {
    let buf = '';
    void Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open(s) {
          for (const l of lines) s.write(`${l}\n`);
        },
        data(s, d) {
          buf += d.toString();
          const got = buf.split('\n').filter(Boolean);
          if (got.length >= n) {
            s.end();
            resolve(got.map((g) => JSON.parse(g)));
          }
        },
        close() {
          resolve(buf.split('\n').filter(Boolean).map((g) => JSON.parse(g)));
        },
      },
    });
  });

describe('helpers', () => {
  test('matchSessionId', () => {
    const ids = ['abc1', 'abc2', 'xyz'];
    expect(matchSessionId('xy', ids)).toEqual({ ok: true, id: 'xyz' });
    expect(matchSessionId('abc1', ids)).toEqual({ ok: true, id: 'abc1' });
    expect(matchSessionId('abc', ids)).toEqual({ ok: false, error: 'ambiguous session id: abc' });
    expect(matchSessionId('q', ids)).toEqual({ ok: false, error: 'no session with id q' });
    expect(matchSessionId(undefined, ids)).toEqual({ ok: false, error: 'missing session id' });
  });
  test('trimScreen', () => {
    expect(trimScreen(['a  ', 'b', '  ', ''])).toEqual(['a', 'b']);
    expect(trimScreen(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
  });
});

describe('ctl server', () => {
  test('publishes ctl.json with a 64-hex token and deletes it on stop', () => {
    const { dir, s } = boot();
    const f = JSON.parse(readFileSync(ctlFile(dir), 'utf8'));
    expect(f).toEqual({ port: s.port, token: s.token, pid: 42 });
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    s.stop();
    expect(existsSync(ctlFile(dir))).toBe(false);
  });
  test('stop keeps a file owned by a newer server', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctl-'));
    dirs.push(dir);
    const a = startCtlServer({ dir, deps: deps() });
    const b = startCtlServer({ dir, deps: deps() });
    servers.push(b);
    a.stop();
    expect(JSON.parse(readFileSync(ctlFile(dir), 'utf8')).port).toBe(b.port);
  });
  test('ping, list, status, screen', async () => {
    const { s } = boot();
    const t = s.token;
    const r = await talk(s.port, [
      JSON.stringify({ token: t, id: 1, method: 'ping' }),
      JSON.stringify({ token: t, id: 2, method: 'list' }),
      JSON.stringify({ token: t, id: 3, method: 'status', params: { id: 'abc' } }),
      JSON.stringify({ token: t, id: 4, method: 'status', params: { id: 'ab' } }),
      JSON.stringify({ token: t, id: 5, method: 'screen', params: { id: 'abc12' } }),
      JSON.stringify({ token: t, id: 6, method: 'screen', params: { id: 'abd' } }),
      JSON.stringify({ token: t, id: 7, method: 'nope' }),
    ], 7);
    const by = (id: number) => r.find((x) => x.id === id);
    expect(by(1)).toEqual({ id: 1, ok: true, result: { version: '1.2.3', pid: 42 } });
    expect(by(2).result.sessions).toHaveLength(2);
    expect(by(3).result.id).toBe('abc123');
    expect(by(4)).toEqual({ id: 4, ok: false, error: 'ambiguous session id: ab' });
    expect(by(5).result.lines).toEqual(['one', 'two']);
    expect(by(6).error).toBe('session is not running here');
    expect(by(7).error).toBe('unknown method: nope');
  });
  test('malformed line keeps the connection; bad token closes it', async () => {
    const { s } = boot();
    const r = await talk(s.port, ['not json', JSON.stringify({ token: s.token, id: 1, method: 'ping' })], 2);
    expect(r.find((x) => x.id === null)?.ok).toBe(false);
    expect(r.find((x) => x.id === 1)?.ok).toBe(true);
    const bad = await talk(s.port, [JSON.stringify({ token: 'x', id: 2, method: 'ping' })], 1);
    expect(bad[0]).toEqual({ id: 2, ok: false, error: 'bad token' });
  });
  test('slow handler answers "did not answer in time"', async () => {
    const { s } = boot({ list: () => new Promise(() => {}) }, { answerMs: 50 });
    const r = await talk(s.port, [JSON.stringify({ token: s.token, id: 1, method: 'list' })], 1);
    expect(r[0]).toEqual({ id: 1, ok: false, error: 'did not answer in time' });
  });
});
