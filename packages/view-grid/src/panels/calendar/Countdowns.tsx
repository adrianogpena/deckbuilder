import { useMemo } from 'react';
import { tKey } from '../../i18n';
import { Chip, ListRows, type ListRow } from '../../kit';
import './calendar.css';
import { daysBetween, parseDated } from './dates';
import { useToday } from './format';

export interface CountdownsConfig {
  items: string;
  showPast: boolean;
  [key: string]: unknown;
}

/** "Today", "N days left" or "N days ago". */
export function countdownText(diff: number): string {
  if (diff === 0) return tKey('dash.calendar.todayLabel');
  const n = Math.abs(diff);
  const plural = n === 1 ? 'one' : 'other';
  return tKey(diff > 0 ? `dash.calendar.daysLeft.${plural}` : `dash.calendar.daysAgo.${plural}`, { n });
}

export function CountdownsPanel({ config }: { config: CountdownsConfig }) {
  const today = useToday();
  const rows = useMemo(() => {
    const dated = parseDated(config.items).map((d) => ({ ...d, diff: daysBetween(today, d.date) }));
    const ahead = dated.filter((d) => d.diff >= 0);
    const past = config.showPast ? dated.filter((d) => d.diff < 0).reverse() : [];
    return [...ahead, ...past].map((d, i): ListRow => ({
      id: `${i}-${d.date}`,
      title: d.label || d.date,
      meta: d.label ? [d.date] : [],
      chip: d.diff === 0 ? <Chip tone="ok">{countdownText(0)}</Chip> : undefined,
      ...(d.diff !== 0 && { trailing: countdownText(d.diff) }),
    }));
  }, [config.items, config.showPast, today]);
  return <ListRows rows={rows} empty={tKey('dash.calendar.countdownsEmpty')} />;
}
