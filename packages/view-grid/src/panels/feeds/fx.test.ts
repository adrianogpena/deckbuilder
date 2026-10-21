import { describe, expect, test } from 'bun:test';
import { currencyCode, mapSeries, startDate, summarize } from './fx';

describe('fx', () => {
  test('series sorted by date, skips missing quotes', () => {
    const raw = { rates: { '2026-10-03': { BRL: 6.3 }, '2026-10-01': { BRL: 6 }, '2026-10-02': {} } };
    expect(mapSeries(raw, 'EUR', 'BRL')).toEqual({ base: 'EUR', quote: 'BRL', dates: ['2026-10-01', '2026-10-03'], values: [6, 6.3] });
    expect(mapSeries(null, 'EUR', 'BRL').values).toEqual([]);
  });

  test('summary is the change against the first day', () => {
    const s = summarize([5, 5.5, 6])!;
    expect(s.value).toBe(6);
    expect(s.change).toBe(1);
    expect(s.percent).toBeCloseTo(20);
    expect(summarize([])).toBeUndefined();
  });

  test('start date and currency code', () => {
    expect(startDate(new Date('2026-10-21T12:00:00Z'), 7)).toBe('2026-10-14');
    expect(currencyCode(' usd ', 'EUR')).toBe('USD');
    expect(currencyCode('dollars', 'EUR')).toBe('EUR');
  });
});
