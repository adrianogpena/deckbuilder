import { expect, test } from 'bun:test';
import { addedDiff, parseDiff } from './diff-parse';
import { askPrompt, linesOf, reviewPrompt } from './prompt';

test('parseDiff numbers old and new lines per hunk', () => {
  const lines = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2,2 +2,2 @@\n a\n-b\n+c\n');
  expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([['hunk', undefined, undefined], ['ctx', 2, 2], ['del', 3, undefined], ['add', undefined, 3]]);
  expect(parseDiff(addedDiff('x\ny\n')).filter((l) => l.kind === 'add').map((l) => l.newNo)).toEqual([1, 2]);
});

test('reviewPrompt lists file:line items then the summary', () => {
  expect(reviewPrompt([{ path: 'a.ts', line: 3, text: 'rename' }, { path: 'b.ts', line: 1, removed: true, text: 'why' }], 'overall')).toBe(
    'Code review comments:\n- a.ts:3 - rename\n- b.ts:1 (removed line) - why\n\nSummary: overall',
  );
});

test('askPrompt and linesOf', () => {
  expect(askPrompt('Explain', 'a.ts', '2-3', 'x\ny')).toBe('Explain this code from a.ts:2-3:\n```\nx\ny\n```');
  expect(linesOf('a\nb\nc\nd', 'b\nc')).toBe('2-3');
  expect(linesOf('a\nb', 'b')).toBe('2');
  expect(linesOf('a', 'zz')).toBeUndefined();
});
