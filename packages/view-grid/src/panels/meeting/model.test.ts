import { describe, expect, test } from 'bun:test';
import { add, localDate, parseMeeting, remove, rename, reset, sorted, toggle, withDailyReset, type Meeting } from './model';

const base: Meeting = { names: ['Ana', 'Bruno'], spoken: { Ana: true }, lastReset: '2026-01-01' };

describe('meeting model', () => {
  test('parseMeeting cleans input', () => {
    expect(parseMeeting(null)).toEqual({ names: [], spoken: {}, lastReset: '' });
    const m = parseMeeting({ names: [' Ana ', 'ana', 3, 'Bo'], spoken: { Ana: true, Zed: true }, lastReset: '2026-01-01' });
    expect(m).toEqual({ names: ['Ana', 'Bo'], spoken: { Ana: true }, lastReset: '2026-01-01' });
  });

  test('daily reset clears spoken on a new day only', () => {
    expect(withDailyReset(base, '2026-01-01')).toBe(base);
    expect(withDailyReset(base, '2026-01-02')).toEqual({ names: ['Ana', 'Bruno'], spoken: {}, lastReset: '2026-01-02' });
    expect(reset(base, '2026-01-01').spoken).toEqual({});
  });

  test('localDate uses local time', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  test('toggle', () => {
    expect(toggle(base, 'Bruno').spoken).toEqual({ Ana: true, Bruno: true });
    expect(toggle(base, 'Ana').spoken).toEqual({});
    expect(toggle(base, 'Nope')).toBe(base);
  });

  test('add validates', () => {
    expect(add(base, '  Carla ').names).toEqual(['Ana', 'Bruno', 'Carla']);
    expect(add(base, 'ANA')).toBe(base);
    expect(add(base, '   ')).toBe(base);
    expect(add(base, 'x'.repeat(61))).toBe(base);
    const full: Meeting = { names: Array.from({ length: 50 }, (_, i) => `n${i}`), spoken: {}, lastReset: '' };
    expect(add(full, 'extra')).toBe(full);
  });

  test('rename keeps the spoken flag', () => {
    const m = rename(base, 'Ana', 'Anna');
    expect(m.names).toEqual(['Anna', 'Bruno']);
    expect(m.spoken).toEqual({ Anna: true });
    expect(rename(base, 'Ana', 'bruno')).toBe(base);
  });

  test('remove', () => {
    expect(remove(base, 'Ana')).toEqual({ names: ['Bruno'], spoken: {}, lastReset: '2026-01-01' });
  });

  test('sorted is case-insensitive', () => {
    expect(sorted(['carla', 'Bruno', 'Ana'])).toEqual(['Ana', 'Bruno', 'carla']);
  });
});
