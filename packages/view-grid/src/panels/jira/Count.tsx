import { tKey } from '../../i18n';
import { StatTile } from '../../kit';
import './jira.css';
import type { CountData } from './server';

export interface CountConfig {
  label: string;
  display: string;
  [key: string]: unknown;
}

export function CountPanel({ config, data }: { config: CountConfig; data: CountData | undefined }) {
  const total = data?.total ?? 0;
  const label = config.label || tKey('dash.jira.total');
  if (config.display === 'number' || !data) return <StatTile value={total} label={label} />;
  const max = Math.max(1, ...data.slices.map((s) => s.count));
  return (
    <div className="jira">
      <div className="jira-head">{label}: {total}</div>
      <ul className="jira-bars">
        {data.slices.map((s) => (
          <li key={s.label || '-'} className="jira-bar">
            <span className="jira-bar-label" title={s.label}>{s.label || tKey('dash.jira.none')}</span>
            <span className="jira-bar-track"><span className="jira-bar-fill" style={{ width: `${(s.count / max) * 100}%` }} /></span>
            <span className="jira-bar-count">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
