import { useMemo } from 'react';
import { Button } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import './calendar.css';
import { sprintInfo, sprintName, sprintWorkingDays, splitWeeks } from './dates';
import { useToday, weekdayName } from './format';
import { weekdayOf } from './dates';

export interface SprintConfig {
  sprintStart: string;
  sprintLengthDays: number;
  cutoffDays: number;
  cutoffLabel: string;
  namePattern: string;
  layout: 'row' | 'weeks';
  [key: string]: unknown;
}

export function SprintPanel({ config, configure }: { config: SprintConfig; configure: () => void }) {
  const today = useToday();
  const info = useMemo(() => sprintInfo(config, today), [config.sprintStart, config.sprintLengthDays, config.cutoffDays, today]);
  const rows = useMemo(() => {
    const days = info ? sprintWorkingDays(info) : [];
    return config.layout === 'weeks' ? splitWeeks(days) : [days];
  }, [info, config.layout]);
  if (!info) {
    return (
      <div className="kit-empty">
        <p>{tKey('dash.calendar.sprintNone')}</p>
        <Button size="sm" onClick={configure}>{tKey('dash.calendar.configure')}</Button>
      </div>
    );
  }
  const weeks = config.layout === 'weeks';
  const columns = weeks ? 5 : Math.max(1, rows[0].length);
  return (
    <div className="sprint">
      <div className="sprint-head">
        <strong>{sprintName(config.namePattern, info.number)}</strong>
        <span className="muted">{tKey(info.daysLeft === 1 ? 'dash.calendar.sprintLeft.one' : 'dash.calendar.sprintLeft.other', { n: info.daysLeft })}</span>
      </div>
      {rows.map((days, i) => (
        <ol key={days[0] ?? i} className="sprint-days" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {days.map((key) => (
            <li key={key} style={weeks ? { gridColumn: weekdayOf(key) } : undefined} className={['sprint-day', key === today && 'sprint-today', key < today && 'sprint-past', info.cutoff === key && 'sprint-cutoff'].filter(Boolean).join(' ')}>
              <span className="sprint-wd">{weekdayName(weekdayOf(key))}</span>
              <span className="sprint-num">{Number(key.slice(8))}</span>
              {info.cutoff === key && <Chip tone="warn">{config.cutoffLabel.trim() || tKey('dash.calendar.cutoff')}</Chip>}
            </li>
          ))}
        </ol>
      ))}
    </div>
  );
}
