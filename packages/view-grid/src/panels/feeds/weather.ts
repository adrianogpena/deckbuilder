/** Icon names of the ui set the weather uses (kept local: this file also runs on the server, without React). */
export type WeatherIcon = 'sun' | 'moon' | 'more' | 'refresh' | 'alert' | 'download';

export type WeatherUnits = 'metric' | 'imperial';

export interface WeatherNow {
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
}
export interface WeatherHour {
  /** Local ISO time, `YYYY-MM-DDTHH:00`. */
  time: string;
  temp: number;
  code: number;
}
export interface WeatherDay {
  /** `YYYY-MM-DD`. */
  date: string;
  max: number;
  min: number;
  code: number;
}
export interface WeatherData {
  found: boolean;
  place: string;
  units: WeatherUnits;
  now?: WeatherNow;
  hourly: WeatherHour[];
  daily: WeatherDay[];
}

export const HOURS = 12;

export const emptyWeather = (units: WeatherUnits): WeatherData => ({ found: false, place: '', units, hourly: [], daily: [] });

/** The i18n key suffix (`dash.feeds.wmo.<suffix>`) of a WMO weather code. */
export function wmoKey(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainlyClear';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'freezingRain';
  if (code >= 61 && code <= 65) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code === 85 || code === 86) return 'snowShowers';
  if (code >= 95 && code <= 99) return 'thunder';
  return 'unknown';
}

/** The icon of a WMO weather code, from the ui icon set. */
export function wmoIcon(code: number, isDay = true): WeatherIcon {
  switch (wmoKey(code)) {
    case 'clear':
    case 'mainlyClear':
    case 'partlyCloudy':
      return isDay ? 'sun' : 'moon';
    case 'overcast':
    case 'fog':
      return 'more';
    case 'snow':
    case 'snowShowers':
      return 'refresh';
    case 'thunder':
      return 'alert';
    case 'unknown':
      return 'more';
    default:
      return 'download';
  }
}

/** The query string of the forecast call. */
export function forecastParams(lat: number, lon: number, units: WeatherUnits, days: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: String(Math.min(16, Math.max(2, days))),
  });
  if (units === 'imperial') {
    params.set('temperature_unit', 'fahrenheit');
    params.set('wind_speed_unit', 'mph');
  }
  return params.toString();
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Maps an Open-Meteo forecast answer: the next `HOURS` hours from now and `days` days. */
export function mapForecast(raw: any, place: string, units: WeatherUnits, days: number): WeatherData {
  const cur = raw?.current;
  const now: WeatherNow | undefined = cur
    ? { temp: num(cur.temperature_2m), feels: num(cur.apparent_temperature), humidity: num(cur.relative_humidity_2m), wind: num(cur.wind_speed_10m), code: num(cur.weather_code), isDay: cur.is_day !== 0 }
    : undefined;
  const times = arr(raw?.hourly?.time) as string[];
  const temps = arr(raw?.hourly?.temperature_2m);
  const codes = arr(raw?.hourly?.weather_code);
  const nowHour = typeof cur?.time === 'string' ? cur.time.slice(0, 13) : '';
  let start = nowHour ? times.findIndex((t) => t.slice(0, 13) >= nowHour) : 0;
  if (start < 0) start = 0;
  const hourly = times.slice(start, start + HOURS).map((time, i) => ({ time, temp: num(temps[start + i]), code: num(codes[start + i]) }));
  const dates = arr(raw?.daily?.time) as string[];
  const max = arr(raw?.daily?.temperature_2m_max);
  const min = arr(raw?.daily?.temperature_2m_min);
  const dcodes = arr(raw?.daily?.weather_code);
  const daily = dates.slice(0, days).map((date, i) => ({ date, max: num(max[i]), min: num(min[i]), code: num(dcodes[i]) }));
  return { found: true, place, units, now, hourly, daily };
}

/** The place label of a geocoding result. */
export function placeName(result: { name?: string; admin1?: string; country?: string }): string {
  return [result.name, result.country].filter(Boolean).join(', ');
}
