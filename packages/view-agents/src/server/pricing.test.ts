import { expect, test } from 'bun:test';
import { costDays, costOf, priceOf, withCost } from './pricing';
import { localDayKey } from './usage-history';

const tk = (input: number, output: number, cacheCreation = 0, cacheRead = 0, cacheCreation1h?: number) => ({ input, output, cacheCreation, cacheRead, cacheCreation1h });

test('matches model families by id prefix', () => {
  expect(priceOf('claude-opus-4-5-20251101')?.input).toBe(5);
  expect(priceOf('claude-opus-4-1-20250805')?.input).toBe(15);
  expect(priceOf('claude-opus-4-20250514')?.output).toBe(75);
  expect(priceOf('us.anthropic.claude-sonnet-4-5-20250929-v1:0')?.input).toBe(3);
  expect(priceOf('claude-haiku-4-5')?.output).toBe(5);
  expect(priceOf('claude-3-5-haiku-20241022')?.input).toBe(0.8);
  expect(priceOf('gpt-4o')).toBeUndefined();
  expect(priceOf('<synthetic>')).toBeUndefined();
  expect(priceOf(undefined)).toBeUndefined();
});

test('costOf sums input, output, cache writes (5m and 1h) and cache reads', () => {
  expect(costOf('claude-sonnet-4-5', tk(1_000_000, 1_000_000))).toBeCloseTo(18);
  expect(costOf('claude-sonnet-4-5', tk(0, 0, 1_000_000, 1_000_000))).toBeCloseTo(3.75 + 0.3);
  expect(costOf('claude-sonnet-4-5', tk(0, 0, 1_000_000, 0, 400_000))).toBeCloseTo(0.6 * 3.75 + 0.4 * 6);
  expect(costOf('mystery', tk(1, 1))).toBeUndefined();
});

test('costDays: today, yesterday and the start of yesterday', () => {
  const now = new Date(2026, 9, 19, 9, 30).getTime();
  const d = costDays(now);
  expect(d.today).toBe(localDayKey(now));
  expect(d.since).toBe(new Date(2026, 9, 18).getTime());
  expect(d.yesterday).toBe(localDayKey(d.since));
});

test('withCost attaches cost and adds accounts that only have cost', () => {
  const out = withCost(
    [{ account: 'a', label: 'main', updatedAt: 5, active: true }],
    new Map([['a', { today: 1, yesterday: 2 }], ['b', { today: 3, yesterday: 0 }]]),
    [{ id: 'a', label: 'main' }, { id: 'b', label: 'work', email: 'w@x' }, { id: 'c', label: 'none' }],
    'a',
  );
  expect(out).toEqual([
    { account: 'a', label: 'main', updatedAt: 5, active: true, cost: { today: 1, yesterday: 2 } },
    { account: 'b', label: 'work', active: false, updatedAt: 0, email: 'w@x', cost: { today: 3, yesterday: 0 } },
  ]);
});
