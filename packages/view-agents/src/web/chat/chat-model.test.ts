import { expect, test } from 'bun:test';
import type { ChatEvent } from '../../chat-protocol.ts';
import { applyEvent, toolSummary, transcriptItems } from './chat-model';

test('deltas merge and a text replaces them', () => {
  let ev: ChatEvent[] = [];
  ev = applyEvent(ev, { type: 'delta', text: 'He', messageId: 'm' });
  ev = applyEvent(ev, { type: 'delta', text: 'llo', messageId: 'm' });
  expect(ev).toEqual([{ type: 'delta', text: 'Hello', messageId: 'm' }]);
  ev = applyEvent(ev, { type: 'thinking', text: 'hmm' });
  ev = applyEvent(ev, { type: 'text', text: 'Hello!', messageId: 'm' });
  expect(ev).toEqual([{ type: 'text', text: 'Hello!', messageId: 'm' }]);
});

test('tool uses pair with results, thinking is dropped', () => {
  const items = transcriptItems([
    { type: 'user', text: 'hi' },
    { type: 'thinking', text: 'x' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
    { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, truncated: true },
    { type: 'tool_result', toolUseId: 't9', content: 'lost', isError: true },
  ]);
  expect(items.map((i) => i.kind)).toEqual(['event', 'tool', 'orphan']);
  expect(items[1].kind === 'tool' && items[1].result?.truncated).toBe(true);
});

test('toolSummary picks the main field', () => {
  expect(toolSummary({ command: 'ls -la' })).toBe('ls -la');
  expect(toolSummary({ a: 1 })).toBe('{"a":1}');
});
