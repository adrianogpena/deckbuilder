import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentAccountUsage } from '../protocol.ts';
import { createSevenDayHistory, localDayKey, pruneHistory, recordSevenDay, type SevenDayHistoryFile } from './usage-history.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('recordSevenDay', () => {
  test('first reading adds 0, rises add the increase, a drop adds the new value', () => {
    const h: SevenDayHistoryFile = {};
    expect(recordSevenDay(h, 'a@x', 10, at(2026, 10, 15))).toBe(true);
    expect(h['a@x']!.days[localDayKey(at(2026, 10, 15))]).toBe(0);
    recordSevenDay(h, 'a@x', 14, at(2026, 10, 15, 13));
    expect(h['a@x']!.days['2026-10-15']).toBe(4);
    recordSevenDay(h, 'a@x', 20, at(2026, 10, 16));
    expect(h['a@x']!.days['2026-10-16']).toBe(6);
    recordSevenDay(h, 'a@x', 3, at(2026, 10, 16, 18));
    expect(h['a@x']!.days['2026-10-16']).toBe(9);
  });

  test('unchanged reading changes nothing', () => {
    const h: SevenDayHistoryFile = {};
    recordSevenDay(h, 'k', 5, at(2026, 10, 15));
    expect(recordSevenDay(h, 'k', 5, at(2026, 10, 16))).toBe(false);
    expect(Object.keys(h.k!.days)).toEqual(['2026-10-15']);
  });
});

test('pruneHistory drops days older than 9', () => {
  const h: SevenDayHistoryFile = { k: { last: 1, days: { '2026-10-07': 1, '2026-10-08': 2, '2026-10-17': 3 } } };
  pruneHistory(h, at(2026, 10, 17));
  expect(h.k!.days).toEqual({ '2026-10-08': 2, '2026-10-17': 3 });
});

test('store keys by email or unknown, writes only on a change, reloads from disk', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hist-')), 'agents', 'seven-day-history.json');
  const now = () => at(2026, 10, 17);
  const usage = (percent: number, email?: string): AgentAccountUsage => ({ account: 'a', label: 'A', updatedAt: now(), ...(email ? { email } : {}), sevenDay: { percent, updatedAt: now() } });
  const s = createSevenDayHistory(() => file, now);
  s.observe([usage(10, 'me@x'), usage(2)]);
  expect(existsSync(file)).toBe(true);
  s.observe([usage(12, 'me@x')]);
  const before = readFileSync(file, 'utf8');
  s.observe([usage(12, 'me@x')]);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(createSevenDayHistory(() => file, now).get()).toEqual({ 'me@x': { '2026-10-17': 2 }, unknown: { '2026-10-17': 0 } });
});
