import { expect, test } from 'bun:test';
import { recordsOf, spendOf, summarize } from './usage-breakdown.ts';

const line = (id: string, at: string, out: number, model = 'claude-sonnet-4-5') =>
  JSON.stringify({ type: 'assistant', cwd: 'C:/Proj/A', timestamp: at, message: { id, model, usage: { input_tokens: 1000, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });

test('recordsOf keeps the last usage of a repeated message id and skips unknown models', () => {
  const text = [line('m1', '2026-10-19T10:00:00Z', 10), line('m1', '2026-10-19T10:00:00Z', 500), line('m2', '2026-10-19T11:00:00Z', 5, 'gpt-x')].join('\n');
  const r = recordsOf(text, 's1', 'fallback');
  expect(r).toHaveLength(1);
  expect(r[0]!.tokens.output).toBe(500);
  expect(r[0]!.project).toBe('C:/Proj/A');
  expect(r[0]!.session).toBe('s1');
});

test('summarize groups by period, day and key; spendOf splits day and month per project', () => {
  const now = new Date(2026, 9, 19, 15, 0).getTime();
  const rec = (at: number, usd: number, session = 's1', model = 'm') => ({ at, session, account: 'a', project: 'C:/Proj/A', model, usd, tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 } });
  const records = [rec(now - 3_600_000, 5), rec(now - 3 * 86_400_000, 2, 's2'), rec(now - 20 * 86_400_000, 1), rec(now - 60 * 86_400_000, 100)];
  const s = summarize(records, now);
  expect(s.today.usd).toBe(5);
  expect(s.week.usd).toBe(7);
  expect(s.month.usd).toBe(8);
  expect(s.days).toHaveLength(30);
  expect(s.burnPerHour).toBe(1);
  expect(s.bySession[0]).toMatchObject({ key: 's1', usd: 6 });
  const sp = spendOf(records, now, (p) => p.toLowerCase());
  expect(sp.day).toBe(5);
  expect(sp.month).toBe(sp.projects['c:/proj/a']!.month);
});
