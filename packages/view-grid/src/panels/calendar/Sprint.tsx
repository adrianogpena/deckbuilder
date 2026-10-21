import { useMemo } from 'react';
import { Button } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import './calendar.css';
import { sprintInfo, sprintName, sprintWorkingDays } from './dates';
import { useToday, weekdayName } from './format';
import { weekdayOf } from './dates';

export interface SprintConfig {
  sprintStart: string;
  sprintLengthDays: number;
  cutoffDays: number;
  namePattern: string;
  [key: string]: unknown;
}

export function SprintPanel({ config, configure }: { config: SprintConfig; configure: () => void }) {
  const today = useToday();
  const info = useMemo(() => sprintInfo(config, today), [config.sprintStart, config.sprintLengthDays, config.cutoffDays, today]);
  const days = useMemo(() => (info ? sprintWorkingDays(info) : []), [info]);
  if (!info) {
    return (
      <div className="kit-empty">
        <p>{tKey('dash.calendar.sprintNone')}</p>
        <Button size="sm" onClick={configure}>{tKey('dash.calendar.configure')}</Button>
      </div>
    );
  }
  return (
    <div className="sprint">
      <div className="sprint-head">
        <strong>{sprintName(config.namePattern, info.number)}</strong>
        <span className="muted">{tKey(info.daysLeft === 1 ? 'dash.calendar.sprintLeft.one' : 'dash.calendar.sprintLeft.other', { n: info.daysLeft })}</span>
      </div>
      <ol className="sprint-days">
        {days.map((key) => (
          <li key={key} className={['sprint-day', key === today && 'sprint-today', key < today && 'sprint-past'].filter(Boolean).join(' ')}>
            <span className="sprint-wd">{weekdayName(weekdayOf(key))}</span>
            <span className="sprint-num">{Number(key.slice(8))}</span>
            {info.cutoff === key && <Chip tone="warn">{tKey('dash.calendar.cutoff')}</Chip>}
          </li>
        ))}
      </ol>
    </div>
  );
}
