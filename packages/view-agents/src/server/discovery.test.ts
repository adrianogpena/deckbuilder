import { afterEach, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheStateOf, capPerProject, createSessionScanner, matchProject } from './discovery';

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

test('cost per local day: repeated message id counted once, unknown model and no timestamp left out', () => {
  const p = setup();
  const file = join(p, 's1.jsonl');
  const u = (i: number, o: number) => ({ input_tokens: i, output_tokens: o });
  const today = new Date(2026, 9, 19, 10).getTime();
  const yesterday = new Date(2026, 9, 18, 22).getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  writeFileSync(
    file,
    jl(
      { type: 'user', cwd: 'C:\\x\\app', message: { content: 'Hi' } },
      { type: 'assistant', timestamp: iso(yesterday), message: { id: 'm0', model: 'claude-sonnet-4-5', usage: u(1_000_000, 0) } },
      { type: 'assistant', timestamp: iso(today), message: { id: 'm1', model: 'claude-sonnet-4-5', usage: u(0, 100_000) } },
      { type: 'assistant', timestamp: iso(today), message: { id: 'm1', model: 'claude-sonnet-4-5', usage: u(0, 200_000) } },
      { type: 'assistant', timestamp: iso(today), message: { id: 'm2', model: 'other', usage: u(5, 5) } },
      { type: 'assistant', message: { id: 'm3', model: 'claude-sonnet-4-5', usage: u(1_000_000, 0) } },
    ),
  );
  const scanner = createSessionScanner();
  scanner.scan([{ id: 'acc', dir }]);
  const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const c = scanner.cost(day(today), day(yesterday), 0).get('acc');
  expect(c?.today).toBeCloseTo(3);
  expect(c?.yesterday).toBeCloseTo(3);
  expect(scanner.cost(day(today), day(yesterday), Date.now() + 86_400_000).size).toBe(0);
});

test('omits tokens and context when the transcript has no usage', () => {
  const p = setup();
  writeFileSync(join(p, 's1.jsonl'), jl({ type: 'user', message: { content: 'Hi' } }, { type: 'assistant', message: { model: 'claude-opus' } }));
  const [a] = createSessionScanner().scan([{ id: 'acc', dir }]);
  expect(a.tokens).toBeUndefined();
  expect(a.contextPercent).toBeUndefined();
});

test('capPerProject keeps live first, then newest, in original order', () => {
  const items = [
    { id: 'a', project: 'p', updatedAt: 5 },
    { id: 'b', project: 'p', updatedAt: 9 },
    { id: 'c', project: 'p', updatedAt: 1, live: true },
    { id: 'd', project: 'q', updatedAt: 1 },
    { id: 'e', project: 'p', updatedAt: 7 },
  ];
  expect(capPerProject(items, 2).map((x) => x.id)).toEqual(['b', 'c', 'd']);
  expect(capPerProject(items, 1).map((x) => x.id)).toEqual(['c', 'd']);
});

test('cache state: newest reply time, TTL from the newest cache write', () => {
  dir = mkdtempSync(join(tmpdir(), 'cache-'));
  const f = join(dir, 't.jsonl');
  const reply = (ts: string, cache_creation?: object) => ({ type: 'assistant', timestamp: ts, message: { usage: { input_tokens: 1, ...(cache_creation ? { cache_creation } : {}) } } });
  writeFileSync(
    f,
    jl(
      reply('2026-01-01T10:00:00.000Z', { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 0 }),
      reply('2026-01-01T10:05:00.000Z', { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }),
      { type: 'user', timestamp: '2026-01-01T10:06:00.000Z' },
    ),
  );
  const size = statSync(f).size;
  expect(cacheStateOf(f, size)).toEqual({ lastRequestAt: Date.parse('2026-01-01T10:05:00.000Z'), ttlMs: 3_600_000 });
  writeFileSync(f, jl(reply('2026-01-01T10:00:00.000Z', { ephemeral_5m_input_tokens: 9 })));
  expect(cacheStateOf(f, statSync(f).size)).toEqual({ lastRequestAt: Date.parse('2026-01-01T10:00:00.000Z'), ttlMs: 300_000 });
  writeFileSync(f, jl(reply('2026-01-01T10:00:00.000Z')));
  expect(cacheStateOf(f, statSync(f).size)?.ttlMs).toBe(300_000);
  writeFileSync(f, jl({ type: 'user', timestamp: '2026-01-01T10:00:00.000Z' }));
  expect(cacheStateOf(f, statSync(f).size)).toBeUndefined();
});
