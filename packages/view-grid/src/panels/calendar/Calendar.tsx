import { useMemo, useState } from 'react';
import { IconButton } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { Chip, ListRows, type ListRow } from '../../kit';
import './calendar.css';
import { addMonths, dayKey, inSprint, isoWeek, monthMatrix, parseDated, sprintInfo, type WeekStart } from './dates';
import { dayTitle, monthTitle, timeOf, useToday, weekdayName } from './format';
import { eventDays, type IcsEvent } from './ics';

export interface CalendarConfig {
  weekStart: WeekStart;
  showWeekNumbers: boolean;
  icsUrl: string;
  upcoming: number;
  sprintStart: string;
  sprintLengthDays: number;
  cutoffDays: number;
  markedDates: string;
  [key: string]: unknown;
}

export function CalendarPanel({ config, events }: { config: CalendarConfig; events: readonly IcsEvent[] }) {
  const today = useToday();
  const [shown, setShown] = useState<string | null>(null);
  const month = shown ?? `${today.slice(0, 8)}01`;
  const [year, month1] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];

  const weeks = useMemo(() => monthMatrix(year, month1 - 1, config.weekStart), [year, month1, config.weekStart]);
  const sprint = useMemo(() => sprintInfo(config, today), [config.sprintStart, config.sprintLengthDays, config.cutoffDays, today]);
  const notes = useMemo(() => {
    const map = new Map<string, string[]>();
    const add = (key: string, text: string) => map.set(key, [...(map.get(key) ?? []), text]);
    for (const m of parseDated(config.markedDates)) add(m.date, m.label);
    for (const ev of events) for (const day of eventDays(ev)) add(day, ev.allDay ? ev.summary : `${timeOf(ev.start)} ${ev.summary}`);
    return map;
  }, [config.markedDates, events]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((ev) => (ev.allDay ? ev.end > today : new Date(ev.end).getTime() >= now))
      .slice(0, config.upcoming)
      .map((ev, i): ListRow => ({
        id: `${i}-${ev.start}`,
        title: ev.summary,
        ...(ev.url && /^https?:\/\//i.test(ev.url) ? { href: ev.url } : {}),
        meta: ev.location ? [ev.location] : [],
        trailing: ev.allDay ? dayTitle(ev.start) : `${dayTitle(dayKey(new Date(ev.start)))} ${timeOf(ev.start)}`,
      }));
  }, [events, config.upcoming, today]);

  const weekdays = Array.from({ length: 7 }, (_, i) => (i + (config.weekStart === 'mon' ? 1 : 0)) % 7);

  return (
    <div className="cal">
      <div className="cal-head">
        <IconButton icon="back" label={tKey('dash.calendar.prev')} onClick={() => setShown(addMonths(month, -1))} />
        <span className="cal-title">{monthTitle(month)}</span>
        <IconButton icon="locate" label={tKey('dash.calendar.today')} onClick={() => setShown(null)} />
        <IconButton icon="forward" label={tKey('dash.calendar.next')} onClick={() => setShown(addMonths(month, 1))} />
      </div>
      {sprint && (
        <div className="cal-sprint">
          <Chip tone="info">{tKey('dash.calendar.sprintDay', { n: sprint.day, m: sprint.length })}</Chip>
        </div>
      )}
      <table className="cal-grid">
        <thead>
          <tr>
            {config.showWeekNumbers && <th className="cal-wk">{tKey('dash.calendar.weekShort')}</th>}
            {weekdays.map((wd) => (
              <th key={wd}>{weekdayName(wd, 'narrow')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {config.showWeekNumbers && <th className="cal-wk">{isoWeek(week[0]!)}</th>}
              {week.map((key) => {
                const note = notes.get(key);
                const cls = [
                  'cal-day',
                  key === today && 'cal-today',
                  key < today && 'cal-past',
                  key.slice(0, 7) !== month.slice(0, 7) && 'cal-other',
                  inSprint(sprint, key) && 'cal-sprint-day',
                  sprint?.cutoff === key && 'cal-cutoff',
                ].filter(Boolean).join(' ');
                const title = [...(sprint?.cutoff === key ? [tKey('dash.calendar.cutoff')] : []), ...(note ?? [])].join('\n');
                return (
                  <td key={key} className={cls} title={title || undefined}>
                    <span>{Number(key.slice(8))}</span>
                    {note && <i className="cal-dot" />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {config.icsUrl.trim() && config.upcoming > 0 && (
        <div className="cal-upcoming">
          <ListRows rows={upcoming} empty={tKey('dash.calendar.upcomingNone')} />
        </div>
      )}
    </div>
  );
}
