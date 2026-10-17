import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchSessions, type SearchHit } from './search.ts';

const line = (o: unknown) => JSON.stringify(o) + '\n';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agents-search-'));
  const a = join(dir, 'a.jsonl');
  const b = join(dir, 'b.jsonl');
  writeFileSync(a, line({ type: 'user', message: { content: 'please fix the Parser bug' } }) + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'parser fixed' }] } }));
  writeFileSync(b, line({ type: 'assistant', message: { content: [{ type: 'text', text: 'nothing here' }, { type: 'tool_use', name: 'parser' }] } }));
  return [{ id: 'a', file: a }, { id: 'b', file: b }];
}

test('first case-insensitive match per session in prompts and assistant text', async () => {
  const hits: SearchHit[] = [];
  await searchSessions(fixture(), 'PARSER', (h) => void hits.push(h), new AbortController().signal);
  expect(hits).toEqual([{ sessionId: 'a', snippet: 'please fix the Parser bug' }]);
});

test('stops on abort and ignores an empty query', async () => {
  const hits: SearchHit[] = [];
  const ac = new AbortController();
  ac.abort();
  await searchSessions(fixture(), 'parser', (h) => void hits.push(h), ac.signal);
  await searchSessions(fixture(), '  ', (h) => void hits.push(h), new AbortController().signal);
  expect(hits).toEqual([]);
});
