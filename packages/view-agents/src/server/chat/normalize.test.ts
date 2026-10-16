import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent } from '../../chat-protocol.ts';
import { findSessionFile, loadHistory, normalizeLine, parseHistory, sessionCwd } from './normalize.ts';

const fixture = (name: string) => parseHistory(readFileSync(join(import.meta.dir, 'fixtures', `${name}.jsonl`), 'utf8'));
const types = (events: ChatEvent[]) => events.map((e) => e.type);

test('a plain turn: init, partial deltas, the text block and the result; hooks and status are dropped', () => {
  const events = fixture('hi');
  expect(types(events)[0]).toBe('init');
  expect(events[0]).toMatchObject({ type: 'init', model: expect.any(String), tools: expect.arrayContaining(['Bash']) });
  expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(0);
  const text = events.find((e) => e.type === 'text');
  expect(text).toMatchObject({ type: 'text', text: expect.stringContaining('Hi!') });
  const last = events.at(-1)!;
  expect(last).toMatchObject({ type: 'result', isError: false, aborted: false, subtype: 'success' });
  expect(types(events)).not.toContain('error');
});

test('tool_use pairs with its tool_result by id', () => {
  const events = fixture('perm-allow');
  const use = events.find((e) => e.type === 'tool_use');
  const res = events.find((e) => e.type === 'tool_result');
  expect(use).toMatchObject({ type: 'tool_use', name: 'Write' });
  expect(res).toMatchObject({ type: 'tool_result', isError: false });
  expect((res as { toolUseId: string }).toolUseId).toBe((use as { id: string }).id);
});

test('an interrupted turn ends with an aborted result and an interrupted marker', () => {
  const events = fixture('interrupt');
  expect(types(events)).toContain('interrupted');
  expect(events.filter((e) => e.type === 'result')[0]).toMatchObject({ aborted: true });
  expect(events.filter((e) => e.type === 'result')[1]).toMatchObject({ aborted: false });
});

test('long tool results are cut', () => {
  const [e] = normalizeLine({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(30_000) }] } });
  expect(e).toMatchObject({ type: 'tool_result', toolUseId: 't1', truncated: true });
  expect((e as { content: string }).content).toHaveLength(20_000);
});

test('history skips bookkeeping entries, sidechains and broken lines', () => {
  const lines = [
    { type: 'queue-operation', operation: 'enqueue' },
    { type: 'attachment', attachment: { type: 'environment' } },
    { type: 'cost-state' },
    { type: 'user', cwd: 'C:\\p', message: { role: 'user', content: 'hello' } },
    { type: 'assistant', isSidechain: true, message: { id: 'm0', content: [{ type: 'text', text: 'side' }] } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi there' }] } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  ].map((l) => JSON.stringify(l));
  const events = parseHistory([...lines, '{"type":"user","mess'].join('\n'));
  expect(events).toEqual([
    { type: 'user', text: 'hello' },
    { type: 'text', text: 'hi there', messageId: 'm1' },
    { type: 'interrupted' },
  ]);
});

test('finds a session file across project folders, its cwd and history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-hist-'));
  mkdirSync(join(dir, 'projects', 'C--a'), { recursive: true });
  mkdirSync(join(dir, 'projects', 'C--b'), { recursive: true });
  const file = join(dir, 'projects', 'C--b', 'abc-1.jsonl');
  writeFileSync(file, `${JSON.stringify({ type: 'queue-operation' })}\n${JSON.stringify({ type: 'user', cwd: 'C:\\b', message: { role: 'user', content: 'q' } })}\n`);
  expect(findSessionFile(dir, 'abc-1')).toBe(file);
  expect(findSessionFile(dir, 'nope')).toBeUndefined();
  expect(findSessionFile(dir, '../x')).toBeUndefined();
  expect(sessionCwd(file)).toBe('C:\\b');
  expect(loadHistory(file)).toEqual([{ type: 'user', text: 'q' }]);
});
