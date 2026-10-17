import { expect, test } from 'bun:test';
import { lastResponseText } from './last-response.ts';

const a = (content: unknown) => JSON.stringify({ type: 'assistant', message: { content } });

test('returns the last assistant message with text, joining text blocks', () => {
  const jsonl = [a([{ type: 'text', text: 'first' }]), a([{ type: 'text', text: 'one' }, { type: 'thinking', thinking: 'x' }, { type: 'text', text: 'two' }]), a([{ type: 'tool_use', name: 'Bash' }])].join('\n');
  expect(lastResponseText(jsonl)).toBe('one\n\ntwo');
});

test('null without text or on partial lines', () => {
  expect(lastResponseText(`${a([{ type: 'tool_use' }])}\n{"type":"assis`)).toBeNull();
  expect(lastResponseText('')).toBeNull();
});
