import { describe, expect, test } from 'bun:test';
import { fmtDuration, hasColumn, relTime } from './time.ts';

const now = Date.UTC(2026, 0, 10, 12, 0, 0);

describe('relTime', () => {
  test('minutes, hours, days', () => {
    expect(relTime(now - 30_000, now)).toBe('now');
    expect(relTime(now - 3 * 60_000, now)).toBe('3m');
    expect(relTime(now - 2 * 3_600_000, now)).toBe('2h');
    expect(relTime(now - 5 * 86_400_000, now)).toBe('5d');
    expect(relTime(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe('2h');
  });

  test('future and invalid dates', () => {
    expect(relTime(now + 60_000, now)).toBe('now');
    expect(relTime('nope', now)).toBe('');
  });
});

describe('fmtDuration', () => {
  test('formats ranges', () => {
    expect(fmtDuration(850)).toBe('850ms');
    expect(fmtDuration(12_000)).toBe('12s');
    expect(fmtDuration(185_000)).toBe('3m 05s');
    expect(fmtDuration(3_720_000)).toBe('1h 02m');
    expect(fmtDuration(-1)).toBe('');
  });
});

describe('hasColumn', () => {
  test('reads a multi field', () => {
    expect(hasColumn({ cols: ['a', 'b'] }, 'cols', 'b')).toBe(true);
    expect(hasColumn({ cols: ['a'] }, 'cols', 'b')).toBe(false);
    expect(hasColumn({}, 'cols', 'a')).toBe(false);
  });
});
