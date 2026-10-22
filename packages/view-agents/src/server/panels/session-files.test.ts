import { expect, test } from 'bun:test';
import { repoRelative, touchedFiles } from './session-files.ts';

const line = (timestamp: string, content: unknown[]) => JSON.stringify({ timestamp, message: { content } });

test('touchedFiles lists edit-tool paths and the start time', () => {
  const jsonl = [
    line('2026-10-22T10:00:00Z', [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:/p/a.ts' } }]),
    line('2026-10-22T10:01:00Z', [{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:\\p\\src\\b.ts' } }]),
    line('2026-10-22T10:02:00Z', [{ type: 'tool_use', name: 'Write', input: { file_path: 'c.ts' } }]),
    'not json',
  ].join('\n');
  const r = touchedFiles(jsonl, 'C:/p');
  expect(r.paths.map((p) => p.toLowerCase())).toEqual(['c:/p/src/b.ts', 'c:/p/c.ts']);
  expect(r.startedAt).toBe(Date.parse('2026-10-22T10:00:00Z'));
});

test('repoRelative returns git-style paths and drops outside ones', () => {
  expect(repoRelative('C:/p', 'C:/p/src/b.ts')).toBe('src/b.ts');
  expect(repoRelative('C:/p', 'C:/other/x.ts')).toBeUndefined();
});
