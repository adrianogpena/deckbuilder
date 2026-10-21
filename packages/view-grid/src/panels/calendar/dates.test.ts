import { describe, expect, test } from 'bun:test';
import { addDays, addMonths, daysBetween, isoWeek, monthMatrix, parseDated, sprintInfo, sprintName, sprintWorkingDays, splitWeeks, weekdayOf, weekRows, weekStartOf } from './dates.ts';

describe('day math', () => {
  test('addDays crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
  test('daysBetween ignores DST', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-05-02', '2026-05-01')).toBe(-1);
  });
  test('addMonths gives the first of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });
  test('isoWeek', () => {
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2021-01-03')).toBe(53);
    expect(isoWeek('2026-12-31')).toBe(53);
  });
});

describe('monthMatrix', () => {
  test('Monday start: October 2026 begins on a Thursday', () => {
    const m = monthMatrix(2026, 9, 'mon');
    expect(m).toHaveLength(6);
    expect(m[0]![0]).toBe('2026-09-28');
    expect(m[0]![3]).toBe('2026-10-01');
    expect(weekdayOf(m[0]![0]!)).toBe(1);
  });
  test('Sunday start', () => {
    const m = monthMatrix(2026, 9, 'sun');
    expect(m[0]![0]).toBe('2026-09-27');
    expect(weekdayOf(m[0]![0]!)).toBe(0);
  });
  test('a month starting on the first day of the week has no lead days', () => {
    expect(monthMatrix(2026, 5, 'mon')[0]![0]).toBe('2026-06-01');
  });
});

describe('sprintInfo', () => {
  const cfg = { sprintStart: '2026-10-05', sprintLengthDays: 14, cutoffDays: 2 };
  test('first day', () => {
    expect(sprintInfo(cfg, '2026-10-05')).toEqual({ number: 1, start: '2026-10-05', end: '2026-10-18', day: 1, length: 14, cutoff: '2026-10-15', daysLeft: 13 });
  });
  test('later sprint and last day', () => {
    const info = sprintInfo(cfg, '2026-11-01')!;
    expect(info.number).toBe(2);
    expect(info.start).toBe('2026-10-19');
    expect(info.day).toBe(14);
    expect(sprintInfo(cfg, '2026-10-18')!.day).toBe(14);
    expect(sprintInfo(cfg, '2026-10-18')!.daysLeft).toBe(0);
  });
  test('no cut-off with 0, none before the start or without a start', () => {
    expect(sprintInfo({ ...cfg, cutoffDays: 0 }, '2026-10-06')!.cutoff).toBeNull();
    expect(sprintInfo(cfg, '2026-10-04')).toBeNull();
    expect(sprintInfo({ ...cfg, sprintStart: '' }, '2026-10-06')).toBeNull();
  });
  test('working days skip weekends', () => {
    const days = sprintWorkingDays(sprintInfo(cfg, '2026-10-05')!);
    expect(days).toHaveLength(10);
    expect(days[5]).toBe('2026-10-12');
    expect(splitWeeks(days).map((w) => w.length)).toEqual([5, 5]);
    expect(splitWeeks(sprintWorkingDays(sprintInfo({ ...cfg, sprintStart: '2026-10-07' }, '2026-10-07')!)).map((w) => w.length)).toEqual([3, 5, 2]);
  });
  test('sprintName', () => {
    expect(sprintName('Sprint {n}', 7)).toBe('Sprint 7');
    expect(sprintName('', 7)).toBe('7');
  });
});

describe('parseDated', () => {
  test('parses, skips invalid lines and sorts', () => {
    const out = parseDated('2026-12-25 | Christmas\nnope | x\n2026-02-30 | bad\n2026-01-01\r\n2026-06-01 |  Mid ');
    expect(out).toEqual([
      { date: '2026-01-01', label: '' },
      { date: '2026-06-01', label: 'Mid' },
      { date: '2026-12-25', label: 'Christmas' },
    ]);
  });
});

describe('weekRows', () => {
  test('starts on the configured weekday and spans the weeks', () => {
    expect(weekStartOf('2026-10-21', 'mon')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-21', 'sun')).toBe('2026-10-18');
    const rows = weekRows('2026-10-18', 'mon', 2);
    expect(rows.map((r) => [r[0], r[6]])).toEqual([['2026-10-12', '2026-10-18'], ['2026-10-19', '2026-10-25']]);
  });
});
