import { expect, test } from 'bun:test';
import { dueAlerts, emptyBudgets, parseBudgets } from './usage.ts';

const now = new Date(2026, 9, 19, 12, 0).getTime();
const spend = (day: number, month: number) => ({ day, month, projects: { 'c:/a': { day, month } } });

test('dueAlerts fires 80 then 100 once per period', () => {
  const b = { ...emptyBudgets(), global: { daily: 10 } };
  const first = dueAlerts(b, spend(8.5, 8.5), now);
  expect(first.alerts).toMatchObject([{ kind: 'daily', level: 80 }]);
  expect(dueAlerts({ ...b, fired: first.fired }, spend(9, 9), now).alerts).toEqual([]);
  const full = dueAlerts({ ...b, fired: first.fired }, spend(11, 11), now);
  expect(full.alerts).toMatchObject([{ level: 100 }]);
  expect(dueAlerts({ ...b, fired: full.fired }, spend(12, 12), now).alerts).toEqual([]);
});

test('dueAlerts fires again in a new day and covers project limits', () => {
  const b = { ...emptyBudgets(), projects: { 'c:/a': { daily: 5 } } };
  const first = dueAlerts(b, spend(6, 6), now);
  expect(first.alerts).toMatchObject([{ scope: 'c:/a', level: 100 }]);
  const tomorrow = now + 86_400_000;
  expect(dueAlerts({ ...b, fired: first.fired }, spend(6, 6), tomorrow).alerts).toHaveLength(1);
});

test('parseBudgets normalizes and rejects bad limits', () => {
  expect(parseBudgets({ global: { daily: 5, monthly: 0 }, projects: { 'C:/A/': { monthly: 20 } } })).toEqual({ global: { daily: 5 }, projects: { 'c:/a': { monthly: 20 } } });
  expect(parseBudgets({ global: { daily: -1 } })).toBeUndefined();
  expect(parseBudgets('x')).toBeUndefined();
});
