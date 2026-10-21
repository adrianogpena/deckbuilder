import { useRef } from 'react';
import { tKey } from '../../i18n';
import { Sparkline, StatTile } from '../../kit';
import type { JsonMetricData } from './server';
import './misc.css';

export const HISTORY = 30;

/** Appends `value` to the last `HISTORY` values (unchanged when it is not a number). */
export const pushHistory = (history: readonly number[], value: number | undefined): number[] =>
  value === undefined ? [...history] : [...history, value].slice(-HISTORY);

export function JsonMetric({ data, label, unit }: { data: JsonMetricData; label: string; unit: string }) {
  const history = useRef<{ data: JsonMetricData | null; values: number[] }>({ data: null, values: [] });
  if (history.current.data !== data) history.current = { data, values: pushHistory(history.current.values, data.value) };
  const shown = data.value !== undefined ? `${data.value.toLocaleString()}${unit ? ` ${unit}` : ''}` : (data.raw ?? '—');
  return (
    <div className="misc-metric">
      <StatTile value={shown} label={label || tKey('dash.misc.json.title')} tone={data.value === undefined ? 'warn' : 'neutral'} delta={data.value === undefined ? tKey('dash.misc.json.notNumber') : undefined} />
      {history.current.values.length > 1 && <Sparkline values={history.current.values} height={32} />}
    </div>
  );
}
