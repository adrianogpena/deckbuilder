import { afterEach, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionScanner, matchProject } from './discovery';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const jl = (...l: unknown[]) => `${l.map((x) => JSON.stringify(x)).join('\n')}\n`;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'disc-'));
  const p = join(dir, 'projects', 'C--x-app');
  mkdirSync(p, { recursive: true });
  return p;
}

test('parses sessions, skips synthetic turns, agent files and sidechains', () => {
  const p = setup();
  writeFileSync(
    join(p, 's1.jsonl'),
    jl(
      { type: 'user', cwd: 'C:\\x\\app', gitBranch: 'main', message: { content: '<command-name>/clear</command-name>' } },
      { type: 'user', isMeta: true, message: { content: 'meta' } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'r' }] } },
      { type: 'user', isSidechain: true, message: { content: 'side' } },
      { type: 'user', message: { content: 'Fix the bug' } },
      { type: 'assistant', message: { model: '<synthetic>' } },
      { type: 'assistant', message: { model: 'claude-opus' } },
    ),
  );
  writeFileSync(
    join(p, 's2.jsonl'),
    jl({ type: 'user', cwd: 'C:\\x\\app', message: { content: 'hello' } }, { type: 'summary', summary: 'My title' }),
  );
  writeFileSync(join(p, 'agent-1.jsonl'), jl({ type: 'user', message: { content: 'sub' } }));
  writeFileSync(join(p, 's3.jsonl'), jl({ type: 'user', isSidechain: true, cwd: 'C:\\x\\app', message: { content: 'sub' } }));
  const out = createSessionScanner().scan([{ id: 'acc', dir }]);
  expect(out.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  const s1 = out.find((s) => s.id === 's1')!;
  expect(s1).toMatchObject({
    account: 'acc',
    cwd: 'C:\\x\\app',
    title: 'Fix the bug',
    firstPrompt: 'Fix the bug',
    gitBranch: 'main',
    model: 'claude-opus',
  });
  expect(out.find((s) => s.id === 's2')!.title).toBe('My title');
});

test('falls back to decoded folder name and caches by mtime and size', () => {
  const p = setup();
  const f = join(p, 's.jsonl');
  writeFileSync(f, jl({ type: 'user', message: { content: 'one' } }));
  const sc = createSessionScanner();
  const a = sc.scan([{ id: 'acc', dir }]);
  expect(a[0].cwd).toBe('C:\\x\\app');
  expect(sc.scan([{ id: 'acc', dir }])[0]).toBe(a[0]);
  writeFileSync(f, jl({ type: 'user', message: { content: 'one' } }, { type: 'summary', summary: 'T' }));
  expect(sc.scan([{ id: 'acc', dir }])[0].title).toBe('T');
});

test('matchProject equals or under, case-insensitive', () => {
  const projects = [
    { name: 'a', path: 'C:\\X\\App' },
    { name: 'b', path: 'C:\\X\\App\\sub' },
  ];
  expect(matchProject('c:\\x\\app', projects, true)?.name).toBe('a');
  expect(matchProject('c:\\x\\app\\sub\\deep', projects, true)?.name).toBe('b');
  expect(matchProject('c:\\x\\application', projects, true)).toBeUndefined();
});

test('sums token usage once per message and reads only appended lines', () => {
  const p = setup();
  const file = join(p, 's1.jsonl');
  const u = (i: number, o: number, cc: number, cr: number) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cc, cache_read_input_tokens: cr });
  writeFileSync(
    file,
    jl(
      { type: 'user', cwd: 'C:\\x\\app', message: { content: 'Hi' } },
      { type: 'assistant', message: { id: 'm1', model: 'claude-opus', usage: u(10, 1, 100, 0) } },
      { type: 'assistant', message: { id: 'm1', model: 'claude-opus', usage: u(10, 5, 100, 0) } },
    ),
  );
  const scanner = createSessionScanner();
  const [a] = scanner.scan([{ id: 'acc', dir }]);
  expect(a.tokens).toEqual({ input: 10, output: 5, cacheCreation: 100, cacheRead: 0 });
  expect(a.contextPercent).toBe(0);
  appendFileSync(file, jl({ type: 'assistant', message: { id: 'm2', model: 'claude-opus', usage: u(2, 3, 0, 39_890) } }) + '{"type":"assistant","mess');
  const [b] = scanner.scan([{ id: 'acc', dir }]);
  expect(b.tokens).toEqual({ input: 12, output: 8, cacheCreation: 100, cacheRead: 39_890 });
  expect(b.contextPercent).toBe(20);
});

test('omits tokens and context when the transcript has no usage', () => {
  const p = setup();
  writeFileSync(join(p, 's1.jsonl'), jl({ type: 'user', message: { content: 'Hi' } }, { type: 'assistant', message: { model: 'claude-opus' } }));
  const [a] = createSessionScanner().scan([{ id: 'acc', dir }]);
  expect(a.tokens).toBeUndefined();
  expect(a.contextPercent).toBeUndefined();
});
