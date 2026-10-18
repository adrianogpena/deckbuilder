import { expect, test } from 'bun:test';
import type { ChatEvent } from '../chat-protocol.ts';
import { compactTurns, shortPath, summarize } from './session-summary';

const use = (id: string, name: string, input: unknown): ChatEvent => ({ type: 'tool_use', id, name, input });
const result = (durationMs: number, costUsd: number): ChatEvent => ({ type: 'result', subtype: 'success', isError: false, aborted: false, durationMs, costUsd });
const events: ChatEvent[] = [
  { type: 'init', sessionId: 's', model: 'opus', tools: [] },
  { type: 'user', text: 'goal' },
  { type: 'text', text: 'working' },
  use('1', 'Edit', { file_path: 'C:/p/a.ts' }),
  use('2', 'Bash', { command: 'ls' }),
  use('3', 'Edit', { file_path: 'C:/p/a.ts' }),
  use('4', 'NotebookEdit', { notebook_path: 'C:/p/n.ipynb' }),
  { type: 'text', text: 'done one' },
  result(1000, 0.5),
  { type: 'user', text: 'again' },
  { type: 'text', text: 'done two' },
  result(500, 0.25),
];

test('summarize totals and files', () => {
  const s = summarize(events);
  expect(s).toEqual({ goal: 'goal', lastPrompt: 'again', lastReply: 'done two', model: 'opus', turns: 2, durationMs: 1500, costUsd: 0.75, files: ['C:/p/a.ts', 'C:/p/n.ipynb'] });
});

test('shortPath is relative inside the cwd', () => {
  expect(shortPath('C:/p/src/a.ts', 'c:/p')).toBe('src/a.ts');
  expect(shortPath('D:/x/a.ts', 'C:/p')).toBe('D:/x/a.ts');
});

test('compactTurns folds tools and keeps the final text', () => {
  const [a, b] = compactTurns(events);
  expect(a.prompt).toBe('goal');
  expect(a.final).toBe('done one');
  expect(a.toolCalls).toBe(4);
  expect(a.toolCounts).toEqual([['Edit', 2], ['Bash', 1], ['NotebookEdit', 1]]);
  expect(a.folded.filter((f) => f.kind === 'text')).toEqual([{ kind: 'text', text: 'working' }]);
  expect(b.final).toBe('done two');
  expect(b.toolCalls).toBe(0);
});
