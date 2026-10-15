import { afterEach, describe, expect, test } from 'bun:test';
import { launchCodes, startServer, TOKEN_HEADER, invalid } from '@deckbuilder/server-core';
import { connect as tcpConnect } from 'node:net';
import { TERMINAL_SOCKET_PATH } from '../protocol.ts';
import type { Pty } from './pty.ts';
import type { Launchers } from './launchers.ts';
import { terminalRoutes, type TerminalRoutesOptions } from './routes.ts';
import { terminalSessions } from './sessions.ts';

const TOKEN = 'test-token';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakePty implements Pty {
  killed = false;
  size = [0, 0];
  private data: Array<(d: Uint8Array) => void> = [];
  private exit: Array<(c: number | null) => void> = [];
  constructor(
    readonly cmd: string[],
    readonly cwd: string,
    readonly env?: Record<string, string>,
  ) {}
  write(d: string | Uint8Array) {
    this.emit(typeof d === 'string' ? d : new TextDecoder().decode(d));
  }
  resize(c: number, r: number) {
    this.size = [c, r];
  }
  kill() {
    this.killed = true;
  }
  onData(cb: (d: Uint8Array) => void) {
    this.data.push(cb);
  }
  onExit(cb: (c: number | null) => void) {
    this.exit.push(cb);
  }
  emit(text: string | Uint8Array) {
    const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
    for (const cb of this.data) cb(bytes);
  }
}

const lookup = { platform: 'linux' as const, env: { SHELL: '/bin/sh' }, exists: () => true };

const fakeLauncher: Launchers = {
  resolve: (id, args) =>
    id === 'claude' && typeof args === 'object' && args !== null && (args as any).resume === 'ok'
      ? { cmd: ['claude', '--resume', 'ok'], env: { A: '1' }, label: 'Claude', meta: { k: 1 }, launcher: 'claude' }
      : null,
  list: () => [{ id: 'claude', label: 'Claude' }],
};

let server: ReturnType<typeof startServer> | null = null;
let sessions: ReturnType<typeof terminalSessions> | null = null;
afterEach(() => {
  sessions?.closeAll();
  sessions = null;
  server?.stop(true);
  server = null;
});

function start(extra: Partial<TerminalRoutesOptions> = {}) {
  const ptys: FakePty[] = [];
  sessions = terminalSessions({
    spawn: (cmd, cwd, _cols, _rows, env) => {
      const p = new FakePty(cmd, cwd, env);
      ptys.push(p);
      return p;
    },
  });
  const { routes, sockets } = terminalRoutes({ sessions, shell: async () => 'auto', lookup, launchers: fakeLauncher, ...extra });
  server = startServer({ routes, sockets, token: TOKEN, codes: launchCodes(), web: { files: {} } });
  const base = `http://127.0.0.1:${server.port}`;
  const call = (method: string, path: string, body?: unknown) =>
    fetch(base + path, { method, headers: { [TOKEN_HEADER]: TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  const post = async (path: string, body: unknown) => {
    const res = await call('POST', path, body);
    return { status: res.status, body: (await res.json()) as any };
  };
  const socket = (ticket: string) => new WebSocket(`ws://127.0.0.1:${server!.port}${TERMINAL_SOCKET_PATH}?t=${ticket}`);
  return { ptys, call, post, socket, port: server.port! };
}

function collect(ws: WebSocket) {
  ws.binaryType = 'arraybuffer';
  const frames: Array<string | Uint8Array> = [];
  ws.onmessage = (e) => frames.push(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer));
  const opened = new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
    ws.onclose = () => resolve(false);
  });
  const text = () => frames.map((f) => (typeof f === 'string' ? f : new TextDecoder().decode(f))).join('');
  const controls = () => frames.filter((f): f is string => typeof f === 'string').map((f) => JSON.parse(f));
  return { frames, opened, text, controls };
}

const open = { cols: 80, rows: 24 };

describe('open and socket', () => {
  test('open returns a ticket; the socket gets hello and echoed input', async () => {
    const { post, socket, ptys } = start();
    const { status, body } = await post('/api/terminal/open', open);
    expect(status).toBe(200);
    expect(ptys[0]!.cmd).toEqual(['/bin/sh', '-l']);
    const ws = socket(body.ticket);
    const got = collect(ws);
    expect(await got.opened).toBe(true);
    ws.send(new TextEncoder().encode('hi\n'));
    await sleep(100);
    expect(got.controls()[0]).toMatchObject({ type: 'hello', session: body.session, cols: 80, rows: 24 });
    expect(got.text()).toContain('hi\n');
    ws.close();
  });

  test('a ticket works once', async () => {
    const { post, socket } = start();
    const { body } = await post('/api/terminal/open', open);
    const first = collect(socket(body.ticket));
    expect(await first.opened).toBe(true);
    expect(await collect(socket(body.ticket)).opened).toBe(false);
  });

  test('resize frames reach the pty and a close frame kills the session', async () => {
    const { post, socket, ptys } = start();
    const { body } = await post('/api/terminal/open', open);
    const ws = socket(body.ticket);
    const got = collect(ws);
    await got.opened;
    ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 40 }));
    ws.send(JSON.stringify({ type: 'resize', cols: 0, rows: 40 }));
    await sleep(80);
    expect(ptys[0]!.size).toEqual([100, 40]);
    ws.send(JSON.stringify({ type: 'close' }));
    await sleep(80);
    expect(ptys[0]!.killed).toBe(true);
    expect(sessions!.list()).toEqual([]);
  });

  test('a dropped socket keeps the shell; attach replays what happened meanwhile', async () => {
    const { post, socket, ptys } = start();
    const { body } = await post('/api/terminal/open', open);
    const ws = socket(body.ticket);
    await collect(ws).opened;
    ws.close();
    await sleep(80);
    ptys[0]!.emit('while-away');
    await sleep(50);
    expect(ptys[0]!.killed).toBe(false);
    const again = await post('/api/terminal/attach', { session: body.session });
    expect(again.status).toBe(200);
    const got = collect(socket(again.body.ticket));
    await got.opened;
    await sleep(100);
    expect(got.text()).toContain('while-away');
  });

  test('a preview receives output and its input is ignored', async () => {
    const { post, socket, ptys } = start();
    const { body } = await post('/api/terminal/open', open);
    const view = await post('/api/terminal/attach', { session: body.session, view: 'preview' });
    const ws = socket(view.body.ticket);
    const got = collect(ws);
    await got.opened;
    ptys[0]!.emit('live-output');
    ws.send(new TextEncoder().encode('typed'));
    ws.send(JSON.stringify({ type: 'resize', cols: 10, rows: 10 }));
    ws.send(JSON.stringify({ type: 'close' }));
    await sleep(100);
    expect(got.text()).toContain('live-output');
    expect(got.text()).not.toContain('typed');
    expect(ptys[0]!.size).toEqual([0, 0]);
    expect(ptys[0]!.killed).toBe(false);
  });

  test('POST close kills the session', async () => {
    const { post, ptys } = start();
    const { body } = await post('/api/terminal/open', open);
    expect((await post('/api/terminal/close', { session: body.session })).status).toBe(200);
    expect(ptys[0]!.killed).toBe(true);
  });
});

describe('validation', () => {
  test('launch spawns the launcher argv; bad args are refused', async () => {
    const { post, ptys } = start();
    const ok = await post('/api/terminal/open', { ...open, launch: { id: 'claude', args: { resume: 'ok' } } });
    expect(ok.status).toBe(200);
    expect(ptys[0]!.cmd).toEqual(['claude', '--resume', 'ok']);
    expect(ptys[0]!.env).toEqual({ A: '1' });
    expect(sessions!.list()[0]).toMatchObject({ label: 'Claude', launcher: 'claude', meta: { k: 1 } });
    for (const launch of [{ id: 'claude', args: { resume: '; rm -rf /' } }, { id: 'nope' }, { id: 5 }, 'claude']) {
      const bad = await post('/api/terminal/open', { ...open, launch });
      expect(bad.status).toBe(400);
    }
    expect(ptys).toHaveLength(1);
  });

  test('launch without launchers is refused', async () => {
    const { post } = start({ launchers: undefined });
    expect((await post('/api/terminal/open', { ...open, launch: { id: 'claude', args: {} } })).status).toBe(400);
  });

  test('bad cols and rows are refused', async () => {
    const { post } = start();
    for (const body of [{ cols: 0, rows: 24 }, { cols: 80, rows: 1001 }, { cols: 1.5, rows: 24 }, { cols: '80', rows: 24 }, { rows: 24 }]) {
      expect((await post('/api/terminal/open', body)).status).toBe(400);
    }
  });

  test('unknown session is 404; a bad view is 400', async () => {
    const { post } = start();
    expect((await post('/api/terminal/attach', { session: 'nope' })).status).toBe(404);
    expect((await post('/api/terminal/label', { session: 'nope', label: 'x' })).status).toBe(404);
    const { body } = await post('/api/terminal/open', open);
    expect((await post('/api/terminal/attach', { session: body.session, view: 'admin' })).status).toBe(400);
    expect((await post('/api/terminal/attach', {})).status).toBe(400);
  });

  test('cwd comes from resolveCwd; its rejection propagates; no root means home', async () => {
    const seen: Array<[string, string]> = [];
    const { post, ptys } = start({
      resolveCwd: async (root, path) => {
        seen.push([root, path]);
        if (root === 'bad') throw invalid('notADirectory', 'nope');
        return '/resolved';
      },
    });
    expect((await post('/api/terminal/open', { ...open, root: 'p', path: 'src' })).status).toBe(200);
    expect(ptys[0]!.cwd).toBe('/resolved');
    expect(seen).toEqual([['p', 'src']]);
    const bad = await post('/api/terminal/open', { ...open, root: 'bad' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('notADirectory');
    await post('/api/terminal/open', open);
    expect(ptys[1]!.cwd).toBe(require('node:os').homedir());
  });

  test('a root without resolveCwd is refused', async () => {
    const { post } = start();
    expect((await post('/api/terminal/open', { ...open, root: 'p' })).status).toBe(400);
  });

  test('label, sessions, shells and launchers routes', async () => {
    const { post, call } = start();
    const { body } = await post('/api/terminal/open', open);
    expect((await post('/api/terminal/label', { session: body.session, label: 'renamed' })).status).toBe(200);
    const list = (await (await call('GET', '/api/terminal/sessions')).json()) as any[];
    expect(list[0]).toMatchObject({ id: body.session, label: 'renamed' });
    expect(await (await call('GET', '/api/terminal/shells')).json()).toContain('auto');
    expect(await (await call('GET', '/api/terminal/launchers')).json()).toEqual([{ id: 'claude', label: 'Claude' }]);
  });

  test('the routes need the session token', async () => {
    const { port } = start();
    expect((await fetch(`http://127.0.0.1:${port}/api/terminal/sessions`)).status).toBe(401);
  });
});

describe('backpressure', () => {
  test('a client that stops reading is closed with 4001 and the session lives on', async () => {
    const { post, ptys, port } = start();
    const { body } = await post('/api/terminal/open', open);
    const received: Uint8Array[] = [];
    const raw = tcpConnect(port, '127.0.0.1');
    raw.on('data', (d: Uint8Array) => received.push(d));
    const closed = new Promise<void>((r) => raw.on('close', () => r()));
    raw.write(
      `GET ${TERMINAL_SOCKET_PATH}?t=${body.ticket} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    await sleep(150);
    raw.pause();
    const chunk = new Uint8Array(64 * 1024).fill(120);
    const viewing = () => sessions!.list()[0]!.viewers.interactive;
    expect(viewing()).toBe(true);
    for (let i = 0; i < 4000 && viewing(); i++) {
      ptys[0]!.emit(chunk);
      if (i % 8 === 0) await sleep(10);
    }
    expect(viewing()).toBe(false);
    expect(sessions!.list()).toHaveLength(1);
    expect(sessions!.list()[0]!.exited).toBeUndefined();
    expect(ptys[0]!.killed).toBe(false);
    raw.resume();
    await Promise.race([closed, sleep(5000)]);
    raw.destroy();
    const all = Buffer.concat(received);
    expect(all.includes(Buffer.from([0x88, 0x0e, 0x0f, 0xa1]))).toBe(true);
  }, 30_000);
});

describe('profiles', () => {
  const dirs = new Set(['/saved', '/prof', '/def', require('node:os').homedir()]);
  const isDir = (p: string) => dirs.has(p);
  const profiles = async () => [
    { id: 'bash', name: 'My bash', shell: 'bash' as const, args: ['-x'], cwd: '/prof', env: { A: '1' } },
    { id: 'tool', name: 'Tool', shell: 'custom' as const, command: '/opt/tool', args: ['--go'] },
  ];

  test('lists built-ins then custom profiles', async () => {
    const { call } = start({ profiles, shellIntegration: async () => false });
    const list = (await (await call('GET', '/api/terminal/profiles')).json()) as any[];
    expect(list.map((p) => p.id)).toEqual(['pwsh', 'bash', 'zsh', 'fish', 'sh', 'tool']);
    expect(list.find((p) => p.id === 'bash')).toMatchObject({ name: 'My bash', icon: 'shell-bash', available: true });
    expect(list.at(-1)).toMatchObject({ id: 'tool', available: true });
  });

  test('open by profile: argv, env, label, cwd; unknown profile is a 400', async () => {
    const { post, ptys } = start({ profiles, isDir, shellIntegration: async () => false });
    expect((await post('/api/terminal/open', { ...open, profile: 'bash' })).status).toBe(200);
    expect(ptys[0]!.cmd).toEqual(['/bin/bash', '-l', '-x']);
    expect(ptys[0]!.cwd).toBe('/prof');
    expect(ptys[0]!.env).toEqual({ A: '1' });
    expect(sessions!.list()[0]).toMatchObject({ label: 'My bash', profile: 'bash', shell: 'bash' });
    expect((await post('/api/terminal/open', { ...open, profile: 'tool' })).status).toBe(200);
    expect(ptys[1]!.cmd).toEqual(['/opt/tool', '--go']);
    expect((await post('/api/terminal/open', { ...open, profile: 'nope' })).body.code).toBe('terminalProfile');
    expect((await post('/api/terminal/open', { ...open, profile: 3 })).status).toBe(400);
  });

  test('defaultProfile applies when none is named; an unknown default falls back to shell', async () => {
    let def = 'tool';
    const { post, ptys } = start({ profiles, defaultProfile: async () => def, shellIntegration: async () => false });
    await post('/api/terminal/open', open);
    expect(ptys[0]!.cmd).toEqual(['/opt/tool', '--go']);
    def = 'nope';
    await post('/api/terminal/open', open);
    expect(ptys[1]!.cmd).toEqual(['/bin/sh', '-l']);
  });

  test('cwd order: root > dir > profile cwd > defaultCwd > home', async () => {
    const { post, ptys } = start({ profiles, isDir, defaultCwd: async () => '/def', resolveCwd: async () => '/root', shellIntegration: async () => false });
    await post('/api/terminal/open', { ...open, profile: 'bash', dir: '/saved', root: 'p' });
    await post('/api/terminal/open', { ...open, profile: 'bash', dir: '/saved' });
    await post('/api/terminal/open', { ...open, profile: 'bash', dir: '/missing' });
    await post('/api/terminal/open', { ...open, dir: 'relative' });
    expect(ptys.map((p) => p.cwd)).toEqual(['/root', '/saved', '/prof', '/def']);
  });

  test('defaultCwd ~ expands to home; a bad one falls back to home', async () => {
    let def = '~';
    const { post, ptys } = start({ isDir, defaultCwd: async () => def });
    await post('/api/terminal/open', open);
    def = '/nowhere';
    await post('/api/terminal/open', open);
    expect(ptys.map((p) => p.cwd)).toEqual([require('node:os').homedir(), require('node:os').homedir()]);
  });

  test('shell integration rewrites a bash argv unless disabled', async () => {
    const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'db-si-'));
    let on = true;
    const { post, ptys } = start({ profiles, integrationDir: dir, shellIntegration: async () => on });
    await post('/api/terminal/open', { ...open, profile: 'bash' });
    expect(ptys[0]!.cmd).toEqual(['/bin/bash', '--rcfile', require('node:path').join(dir, 'bash.sh').replace(/\\/g, '/'), '-x', '-i']);
    on = false;
    await post('/api/terminal/open', { ...open, profile: 'bash' });
    expect(ptys[1]!.cmd).toEqual(['/bin/bash', '-l', '-x']);
  });
});
