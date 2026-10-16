import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatServerFrame, ChatState } from '../../chat-protocol.ts';
import type { AgentAccount } from '../accounts.ts';
import { createChatManager } from './manager.ts';
import type { SpawnFn } from './process.ts';

interface Fake {
  cmd: string[];
  env: Record<string, string>;
  written: any[];
  killed: boolean;
  push(o: unknown): void;
  die(code?: number): void;
}

const INIT = { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'm', tools: ['Bash'], cwd: 'C:\\p' };
const result = (text: string, extra: object = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: text, ...extra });
const reply = (text: string) => [INIT, { type: 'assistant', message: { id: `m-${text}`, content: [{ type: 'text', text }] } }, result(text)];

function harness(script: (msg: any, p: Fake) => void) {
  const procs: Fake[] = [];
  const enc = new TextEncoder();
  const spawn: SpawnFn = (cmd, opts) => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stdout = new ReadableStream<Uint8Array>({ start: (c) => (ctrl = c) });
    let exit!: (n: number) => void;
    const exited = new Promise<number>((r) => (exit = r));
    const p: Fake = {
      cmd,
      env: opts.env,
      written: [],
      killed: false,
      push: (o) => ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)),
      die: (code = 1) => {
        try {
          ctrl.close();
        } catch {
          /* closed */
        }
        exit(code);
      },
    };
    procs.push(p);
    return {
      stdin: {
        write: (s: string) => {
          const msg = JSON.parse(s);
          p.written.push(msg);
          script(msg, p);
        },
      },
      stdout,
      kill: () => {
        p.killed = true;
        p.die(0);
      },
      exited,
    };
  };
  const cwd = mkdtempSync(join(tmpdir(), 'chat-cwd-'));
  const dir = join(mkdtempSync(join(tmpdir(), 'chat-dir-')), 'chat');
  const dflt: AgentAccount = { id: '.claude', dir: join(cwd, '.claude'), label: 'd', isDefault: true };
  const other: AgentAccount = { id: '.claude-w', dir: join(cwd, '.claude-w'), label: 'w', isDefault: false };
  const mgr = createChatManager({
    dir,
    accounts: () => [dflt, other],
    baseUrl: () => 'http://127.0.0.1:9',
    spawn,
    claudeCmd: 'claude',
    env: { PATH: 'p', CLAUDE_CONFIG_DIR: 'inherited' },
    interruptMs: 30,
  });
  const frames: ChatServerFrame[] = [];
  const sub = { send: (f: ChatServerFrame) => frames.push(f) };
  const open = (frame: Parameters<typeof mgr.open>[0] = { cwd }) => {
    const r = mgr.open(frame);
    if ('error' in r) throw new Error(r.error.message);
    r.session.subscribe(sub);
    return r.session;
  };
  const events = () => frames.flatMap((f) => (f.type === 'event' ? [f.event] : [])) as ChatEvent[];
  const state = () => frames.filter((f) => f.type === 'state').at(-1) as ({ type: 'state' } & ChatState) | undefined;
  return { mgr, procs, frames, events, state, open, cwd, dir, dflt, other };
}

const until = async (pred: () => unknown, ms = 2000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout');
    await Bun.sleep(5);
  }
};

test('a turn: spawns once, sends the user line, normalises output and registers the session id', async () => {
  const h = harness((msg, p) => {
    if (msg.type === 'user') for (const l of reply(msg.message.content)) p.push(l);
  });
  const s = h.open({ cwd: h.cwd, model: 'haiku' });
  expect(h.frames.map((f) => f.type)).toEqual(['opened', 'history', 'state']);
  s.send('hello');
  await until(() => h.events().some((e) => e.type === 'result'));
  expect(h.events().map((e) => e.type)).toEqual(['user', 'init', 'text', 'result']);
  expect(s.sessionId).toBe('sess-1');
  expect(h.state()).toMatchObject({ run: 'idle', queue: [], permissionMode: 'default' });
  expect(h.procs).toHaveLength(1);
  const { cmd, written } = h.procs[0]!;
  expect(written).toEqual([{ type: 'user', message: { role: 'user', content: 'hello' } }]);
  expect(cmd).toEqual(expect.arrayContaining(['-p', '--include-partial-messages', '--permission-prompt-tool', 'mcp__perm__approve', '--model', 'haiku']));
  expect(cmd).not.toContain('--resume');
  s.send('again');
  await until(() => h.events().filter((e) => e.type === 'result').length === 2);
  expect(h.procs).toHaveLength(1);
  s.close();
});

test('CLAUDE_CONFIG_DIR is unset for the default account and set for the others', async () => {
  const h = harness((msg, p) => msg.type === 'user' && p.push(result('ok')));
  const a = h.open({ cwd: h.cwd });
  a.send('x');
  const b = h.open({ cwd: h.cwd, accountId: '.claude-w' });
  b.send('y');
  await until(() => h.procs.length === 2);
  expect(h.procs[0]!.env.CLAUDE_CONFIG_DIR).toBeUndefined();
  expect(h.procs[1]!.env.CLAUDE_CONFIG_DIR).toBe(h.other.dir);
  expect(h.procs[0]!.env.PATH).toBe('p');
  h.mgr.closeAll();
});

test('follow-ups queue while a turn runs, can be edited or removed, and go out on the result', async () => {
  const h = harness((msg, p) => {
    if (msg.type === 'user' && msg.message.content === 'one') p.push(INIT);
    else if (msg.type === 'user') p.push(result(msg.message.content));
  });
  const s = h.open();
  s.send('one');
  s.send('two');
  s.send('three');
  s.send('four');
  const q = h.state()!.queue;
  expect(q.map((m) => m.text)).toEqual(['two', 'three', 'four']);
  s.editQueued(q[0]!.id, 'two!');
  s.removeQueued(q[1]!.id);
  expect(h.state()!.queue.map((m) => m.text)).toEqual(['two!', 'four']);
  h.procs[0]!.push(result('one'));
  await until(() => h.events().filter((e) => e.type === 'result').length === 3);
  expect(h.procs[0]!.written.map((m) => m.message.content)).toEqual(['one', 'two!', 'four']);
  expect(h.state()).toMatchObject({ run: 'idle', queue: [] });
  s.close();
});

test('interrupt sends the control request and the process stays alive', async () => {
  const h = harness((msg, p) => {
    if (msg.type === 'control_request') {
      p.push({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id } });
      p.push(result('', { subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming' }));
    } else if (msg.type === 'user' && msg.message.content === 'long') p.push(INIT);
    else if (msg.type === 'user') p.push(result('after'));
  });
  const s = h.open();
  s.send('long');
  await s.interrupt();
  await until(() => h.events().some((e) => e.type === 'result'));
  expect(h.procs[0]!.written[1]).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } });
  expect(h.events().find((e) => e.type === 'result')).toMatchObject({ aborted: true });
  expect(h.procs[0]!.killed).toBe(false);
  s.send('next');
  await until(() => h.events().filter((e) => e.type === 'result').length === 2);
  expect(h.procs).toHaveLength(1);
  s.close();
});

test('an unacknowledged interrupt kills the process and the next send resumes the session', async () => {
  const h = harness((msg, p) => {
    if (msg.type === 'user' && msg.message.content === 'long') p.push(INIT);
    else if (msg.type === 'user') p.push(result('resumed'));
  });
  const s = h.open();
  s.send('long');
  await until(() => s.sessionId);
  await s.interrupt();
  expect(h.procs[0]!.killed).toBe(true);
  expect(h.events().map((e) => e.type)).toContain('interrupted');
  expect(h.state()!.run).toBe('idle');
  s.send('next');
  await until(() => h.procs.length === 2);
  expect(h.procs[1]!.cmd).toEqual(expect.arrayContaining(['--resume', 'sess-1']));
  await until(() => h.events().some((e) => e.type === 'result'));
  s.close();
});

test('a process that dies mid-turn reports an error and the next send resumes', async () => {
  const h = harness((msg, p) => {
    if (msg.type !== 'user') return;
    if (p === h.procs[0]) {
      p.push(INIT);
      p.die(3);
    } else p.push(result('back'));
  });
  const s = h.open();
  s.send('boom');
  await until(() => h.events().some((e) => e.type === 'error'));
  expect(h.events().find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('3') });
  expect(h.state()!.run).toBe('idle');
  s.send('again');
  await until(() => h.procs.length === 2);
  expect(h.procs[1]!.cmd).toEqual(expect.arrayContaining(['--resume', 'sess-1']));
  s.close();
});

test('permission prompts go to the client; Allow, Always and Deny answer the CLI through the MCP endpoint', async () => {
  const h = harness((msg, p) => msg.type === 'user' && p.push(INIT));
  const s = h.open();
  s.send('go');
  const mcpFile = join(h.dir, `${s.token}.mcp.json`);
  expect(JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers.perm.url).toBe(`http://127.0.0.1:9/api/agents/chat-mcp/${s.token}`);
  const ask = async (tool: string, input: unknown) => {
    const res = await h.mgr.mcp(s.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'approve', arguments: { tool_name: tool, input, tool_use_id: 'tu' } },
    });
    const body = await res.text();
    return JSON.parse(JSON.parse(body.split('data: ')[1]!.trim()).result.content[0].text);
  };

  const first = ask('Write', { file_path: 'a' });
  await until(() => h.state()!.permissions.length === 1);
  const req = h.state()!.permissions[0]!;
  expect(req).toMatchObject({ toolName: 'Write', input: { file_path: 'a' }, toolUseId: 'tu' });
  s.answer(req.id, 'always');
  expect(await first).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a' } });
  expect(h.state()!.always).toEqual(['Write']);
  expect(await ask('Write', { file_path: 'b' })).toEqual({ behavior: 'allow', updatedInput: { file_path: 'b' } });
  expect(h.state()!.permissions).toHaveLength(0);

  const bash = ask('Bash', { command: 'rm -rf x' });
  await until(() => h.state()!.permissions.length === 1);
  s.answer(h.state()!.permissions[0]!.id, 'deny');
  expect(await bash).toMatchObject({ behavior: 'deny' });

  const bash2 = ask('Bash', { command: 'ls' });
  await until(() => h.state()!.permissions.length === 1);
  s.answer(h.state()!.permissions[0]!.id, 'always');
  await bash2;
  expect(h.state()!.always).toEqual(['Write', 'Bash:ls']);

  expect((await h.mgr.mcp('bad-token', {})).status).toBe(404);
  s.close();
  expect(existsSync(mcpFile)).toBe(false);
  expect((await h.mgr.mcp(s.token, {})).status).toBe(404);
});

test('opening an existing session finds its account and cwd in the jsonl and shows its history', () => {
  const h = harness(() => {});
  const folder = join(h.other.dir, 'projects', 'C--p');
  mkdirSync(folder, { recursive: true });
  const lines = [
    { type: 'user', cwd: h.cwd, message: { role: 'user', content: 'old question' } },
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'old answer' }] } },
  ];
  writeFileSync(join(folder, 'old-1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  const s = h.open({ sessionId: 'old-1' });
  expect(s.account.id).toBe('.claude-w');
  expect(s.cwd).toBe(h.cwd);
  expect(h.frames[0]).toMatchObject({ type: 'opened', sessionId: 'old-1', accountId: '.claude-w' });
  expect(h.frames[1]).toMatchObject({ type: 'history', events: [{ type: 'user', text: 'old question' }, { type: 'text', text: 'old answer' }] });
  expect(h.mgr.open({ sessionId: 'missing' })).toEqual({ error: { code: 'sessionNotFound', message: expect.any(String) } });
  expect(h.mgr.open({ cwd: join(h.cwd, 'nope') })).toMatchObject({ error: { code: 'badCwd' } });
  s.close();
});

test('changing the permission mode restarts the process with it on the next send', async () => {
  const h = harness((msg, p) => msg.type === 'user' && p.push(msg.message.content === 'a' ? INIT : result('r')));
  const s = h.open();
  s.send('a');
  h.procs[0]!.push(result('r'));
  await until(() => h.state()!.run === 'idle' && h.events().some((e) => e.type === 'result'));
  s.setMode('acceptEdits');
  s.send('b');
  await until(() => h.procs.length === 2);
  expect(h.procs[0]!.killed).toBe(true);
  expect(h.procs[1]!.cmd).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits', '--resume', 'sess-1']));
  s.close();
});
