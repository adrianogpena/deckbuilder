import { expect, test } from 'bun:test';
import { barCells, cacheState, costTrend, formatCost, historyRows, isStale, liveLimit, modelLine, resetLabel, severity, shortDuration, shownPercent, startupShown, STALE_MS } from './usage-format';

test('severity per metric thresholds', () => {
  expect(severity('context', 19)).toBe('ok');
  expect(severity('context', 20)).toBe('warn');
  expect(severity('context', 50)).toBe('err');
  expect(severity('fiveHour', 79.9)).toBe('warn');
  expect(severity('fiveHour', 80)).toBe('err');
  expect(severity('sevenDay', 69)).toBe('ok');
  expect(severity('sevenDay', 90)).toBe('err');
});

test('bar cells and shown percent are clamped and rounded', () => {
  expect(barCells(0)).toBe(0);
  expect(barCells(44)).toBe(4);
  expect(barCells(45)).toBe(5);
  expect(barCells(150)).toBe(10);
  expect(barCells(-5)).toBe(0);
  expect(shownPercent(41.6)).toBe(42);
  expect(shownPercent(120)).toBe(100);
});

test('stale readings and passed resets', () => {
  const now = 1_000_000_000;
  expect(isStale(now - STALE_MS - 1, now)).toBe(true);
  expect(isStale(now - STALE_MS, now)).toBe(false);
  expect(isStale(undefined, now)).toBe(false);
  expect(liveLimit({ percent: 5, resetsAt: now }, now)).toBeUndefined();
  expect(liveLimit({ percent: 5, resetsAt: now + 1 }, now)?.percent).toBe(5);
  expect(liveLimit({ percent: 5 }, now)?.percent).toBe(5);
});

test('reset labels: time only for 5h, weekday for 7d', () => {
  const at = new Date(2026, 9, 19, 20, 30).getTime();
  expect(resetLabel(at, 'fiveHour', false)).toBe('8:30 PM');
  expect(resetLabel(at, 'fiveHour', true)).toBe('20:30');
  expect(resetLabel(at, 'sevenDay', true)).toBe('Mon 20:30');
  expect(resetLabel(new Date(2026, 9, 19, 0, 5).getTime(), 'fiveHour', true)).toBe('00:05');
});

test('cache label state: minutes left rounded up, then time since the last request', () => {
  const now = 10_000_000;
  expect(cacheState({ lastRequestAt: now - 60_000, ttlMs: 300_000 }, now)).toEqual({ warm: true, minutesLeft: 4 });
  expect(cacheState({ lastRequestAt: now - 61_000, ttlMs: 300_000 }, now)).toEqual({ warm: true, minutesLeft: 4 });
  expect(cacheState({ lastRequestAt: now - 299_000, ttlMs: 300_000 }, now)).toEqual({ warm: true, minutesLeft: 1 });
  expect(cacheState({ lastRequestAt: now - 720_000, ttlMs: 300_000 }, now)).toEqual({ warm: false, since: '12m' });
  expect(shortDuration(3 * 3_600_000)).toBe('3h');
  expect(shortDuration(50 * 3_600_000)).toBe('2d');
});

test('model line and startup baseline', () => {
  expect(modelLine('Opus 4.1', 'high')).toBe('Opus 4.1 · high');
  expect(modelLine('Opus 4.1', undefined)).toBe('Opus 4.1');
  expect(modelLine(undefined, 'high')).toBeUndefined();
  expect(startupShown(42, 12)).toBe(12);
  expect(startupShown(12, 12)).toBeUndefined();
  expect(startupShown(undefined, 12)).toBeUndefined();
});

test('historyRows: last 5 local days latest first, two-letter weekdays, gaps undefined', () => {
  const rows = historyRows({ '2026-10-17': 3.4, '2026-10-15': 0 }, new Date(2026, 9, 17, 9).getTime());
  expect(rows.map((r) => r.day)).toEqual(['2026-10-17', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13']);
  expect(rows.map((r) => r.weekday)).toEqual(['Sa', 'Fr', 'Th', 'We', 'Tu']);
  expect(rows.map((r) => r.percent)).toEqual([3.4, undefined, 0, undefined, undefined]);
});

test('formatCost', () => {
  expect(formatCost(undefined)).toBe('—');
  expect(formatCost(0)).toBe('$0.00');
  expect(formatCost(0.001)).toBe('<$0.01');
  expect(formatCost(3.456)).toBe('$3.46');
  expect(formatCost(1234.5)).toBe('$1,234.50');
});

test('costTrend', () => {
  expect(costTrend(undefined, 1)).toBeUndefined();
  expect(costTrend(2, 1)).toEqual({ dir: 'up', pct: 100 });
  expect(costTrend(1, 4)).toEqual({ dir: 'down', pct: 75 });
  expect(costTrend(1, 1)).toEqual({ dir: 'flat', pct: 0 });
  expect(costTrend(1, 0)).toEqual({ dir: 'up' });
});
