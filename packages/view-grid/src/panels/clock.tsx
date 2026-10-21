import { useEffect, useState } from 'react';
import { CLOCK_FIELDS } from '../clock-fields';
import { definePanel } from '../panel';
import { tKey } from '../i18n';

export interface ClockConfig {
  timeZone: string;
  hour12: boolean;
  showSeconds: boolean;
  showDate: boolean;
  [key: string]: unknown;
}

/** The time and date formatted for `config`; an unknown time zone falls back to the local one (`valid: false`). */
export function formatClock(now: Date, config: ClockConfig): { time: string; date: string; valid: boolean } {
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', ...(config.showSeconds && { second: '2-digit' }), hour12: config.hour12 };
  const date: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  const zone = config.timeZone.trim();
  try {
    return {
      time: now.toLocaleTimeString(undefined, { ...time, ...(zone && { timeZone: zone }) }),
      date: now.toLocaleDateString(undefined, { ...date, ...(zone && { timeZone: zone }) }),
      valid: true,
    };
  } catch {
    return { time: now.toLocaleTimeString(undefined, time), date: now.toLocaleDateString(undefined, date), valid: false };
  }
}

function Clock({ config }: { config: ClockConfig }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), config.showSeconds ? 1000 : 10_000);
    return () => window.clearInterval(timer);
  }, [config.showSeconds]);
  const { time, date, valid } = formatClock(now, config);
  return (
    <div>
      <div className="mono grid-clock-time">{time}</div>
      {config.showDate && <div className="muted">{date}</div>}
      {!valid && <div className="muted">{tKey('grid.clock.invalidZone')}</div>}
    </div>
  );
}

/** Built-in kind `clock`: the time (and date) in a chosen time zone. */
export const clockPanel = definePanel<ClockConfig>({
  kind: 'clock',
  title: 'grid.panel.clock',
  description: 'grid.panel.clock.description',
  icon: 'refresh',
  category: 'grid.category.time',
  size: { w: 6, h: 8, minW: 3, minH: 4 },
  config: { fields: CLOCK_FIELDS },
  allowMultiple: true,
  render: ({ config }) => <Clock config={config} />,
});
