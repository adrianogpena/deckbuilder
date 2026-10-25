import { Button, Icon } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { hasColumn } from '../../kit';
import './feeds.css';
import { wmoIcon, wmoKey, type WeatherData } from './weather';

export interface WeatherConfig {
  location: string;
  units: 'metric' | 'imperial';
  show: string[];
  days: number;
  layout?: 'full' | 'current' | 'forecastRow' | 'forecastColumn';
  [key: string]: unknown;
}

const locale = (): string | undefined => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;
const deg = (n: number): string => `${Math.round(n)}°`;
const label = (code: number): string => tKey(`dash.feeds.wmo.${wmoKey(code)}`);

export function WeatherPanel({ config, data, configure }: { config: WeatherConfig; data: WeatherData | undefined; configure: () => void }) {
  if (!config.location.trim() || (data && !data.found)) {
    return (
      <div className="kit-empty">
        <p>{tKey(config.location.trim() ? 'dash.feeds.weather.notFound' : 'dash.feeds.weather.none')}</p>
        <Button size="sm" variant="primary" icon="settings" onClick={configure}>{tKey('grid.setUp')}</Button>
      </div>
    );
  }
  if (!data) return null;
  const unit = data.units === 'imperial' ? '°F' : '°C';
  const speed = data.units === 'imperial' ? 'mph' : 'km/h';
  const layout = config.layout ?? 'full';
  const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
  if (layout !== 'full') {
    const days = layout === 'current' ? [] : data.daily;
    return (
      <div className={`wx wx-${layout}`}>
        <div className="wx-place">{data.place}</div>
        {data.now && (
          <div className="wx-now">
            <Icon name={wmoIcon(data.now.code, data.now.isDay)} size={layout === 'current' ? 48 : 36} />
            <span className="wx-temp">{Math.round(data.now.temp)}{unit}</span>
            <span className="wx-now-meta">
              <span>{label(data.now.code)}</span>
              <span>{tKey('dash.feeds.weather.feels', { temp: deg(data.now.feels) })} · {Math.round(data.now.wind)} {speed} · {Math.round(data.now.humidity)}%</span>
            </span>
          </div>
        )}
        {days.length > 0 && layout === 'forecastRow' && (
          <ul className="wx-hourly">
            {days.map((d) => (
              <li key={d.date} className="wx-hour" title={label(d.code)}>
                <span className="wx-sub">{weekday.format(new Date(`${d.date}T00:00:00Z`))}</span>
                <Icon name={wmoIcon(d.code, true)} size={16} />
                <b>{deg(d.max)}</b>
                <span className="wx-sub">{deg(d.min)}</span>
              </li>
            ))}
          </ul>
        )}
        {days.length > 0 && layout === 'forecastColumn' && (
          <ul className="wx-daily">
            {days.map((d) => (
              <li key={d.date} className="wx-day">
                <span className="wx-day-name">{weekday.format(new Date(`${d.date}T00:00:00Z`))}</span>
                <Icon name={wmoIcon(d.code, true)} size={16} />
                <span className="wx-sub wx-day-label">{label(d.code)}</span>
                <span className="wx-range"><b>{deg(d.max)}</b> <span className="wx-sub">{deg(d.min)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const showNow = hasColumn(config, 'show', 'now') && data.now;
  const showHourly = hasColumn(config, 'show', 'hourly') && data.hourly.length > 0;
  const showDaily = hasColumn(config, 'show', 'daily') && data.daily.length > 0;
  return (
    <div className="wx">
      <div className="wx-place">{data.place}</div>
      {showNow && data.now && (
        <div className="wx-now">
          <Icon name={wmoIcon(data.now.code, data.now.isDay)} size={36} />
          <span className="wx-temp">{Math.round(data.now.temp)}{unit}</span>
          <span className="wx-now-meta">
            <span>{label(data.now.code)}</span>
            <span>{tKey('dash.feeds.weather.feels', { temp: deg(data.now.feels) })} · {Math.round(data.now.wind)} {speed} · {Math.round(data.now.humidity)}%</span>
          </span>
        </div>
      )}
      {showHourly && (
        <ul className="wx-hourly">
          {data.hourly.map((h) => (
            <li key={h.time} className="wx-hour" title={label(h.code)}>
              <span className="wx-sub">{h.time.slice(11, 16)}</span>
              <Icon name={wmoIcon(h.code, true)} size={16} />
              <span>{deg(h.temp)}</span>
            </li>
          ))}
        </ul>
      )}
      {showDaily && (
        <ul className="wx-daily">
          {data.daily.map((d) => (
            <li key={d.date} className="wx-day">
              <span className="wx-day-name">{weekday.format(new Date(`${d.date}T00:00:00Z`))}</span>
              <Icon name={wmoIcon(d.code, true)} size={16} />
              <span className="wx-sub wx-day-label">{label(d.code)}</span>
              <span className="wx-range"><b>{deg(d.max)}</b> <span className="wx-sub">{deg(d.min)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
