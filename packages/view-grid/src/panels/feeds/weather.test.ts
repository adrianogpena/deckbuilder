import { describe, expect, test } from 'bun:test';
import { forecastParams, mapForecast, placeName, wmoIcon, wmoKey } from './weather';

const raw = {
  current: { time: '2026-10-21T10:15', temperature_2m: 18.2, apparent_temperature: 17, relative_humidity_2m: 60, weather_code: 2, wind_speed_10m: 11, is_day: 1 },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-10-${21 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 48 }, (_, i) => i),
    weather_code: Array.from({ length: 48 }, () => 3),
  },
  daily: { time: ['2026-10-21', '2026-10-22', '2026-10-23'], weather_code: [0, 61, 95], temperature_2m_max: [20, 19, 18], temperature_2m_min: [10, 11, 12] },
};

describe('weather', () => {
  test('wmo codes map to keys and icons', () => {
    expect(wmoKey(0)).toBe('clear');
    expect(wmoKey(63)).toBe('rain');
    expect(wmoKey(95)).toBe('thunder');
    expect(wmoKey(1234)).toBe('unknown');
    expect(wmoIcon(0, true)).toBe('sun');
    expect(wmoIcon(0, false)).toBe('moon');
  });

  test('imperial adds unit params', () => {
    expect(forecastParams(1, 2, 'imperial', 5)).toContain('temperature_unit=fahrenheit');
    expect(forecastParams(1, 2, 'imperial', 5)).toContain('wind_speed_unit=mph');
    expect(forecastParams(1, 2, 'metric', 5)).not.toContain('fahrenheit');
  });

  test('maps current, the next 12 hours and the days', () => {
    const data = mapForecast(raw, 'Lisbon, Portugal', 'metric', 2);
    expect(data.found).toBe(true);
    expect(data.now?.temp).toBe(18.2);
    expect(data.hourly).toHaveLength(12);
    expect(data.hourly[0]!.time).toBe('2026-10-21T10:00');
    expect(data.daily.map((d) => d.max)).toEqual([20, 19]);
  });

  test('tolerates a missing body', () => {
    const data = mapForecast({}, 'x', 'metric', 3);
    expect(data.now).toBeUndefined();
    expect(data.hourly).toEqual([]);
  });

  test('place name', () => {
    expect(placeName({ name: 'Lisbon', country: 'Portugal' })).toBe('Lisbon, Portugal');
  });
});
