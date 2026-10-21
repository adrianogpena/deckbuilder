import type { ReactNode } from 'react';
import { tKey } from '../../i18n';
import { hasColumn, relTime, StatTile, type Tone } from '../../kit';
import './github.css';
import type { RepoStats } from './more';

export interface OverviewConfig {
  show: string[];
  [key: string]: unknown;
}

const CI_TONE: Record<string, Tone> = { pass: 'ok', fail: 'danger', pending: 'warn', none: 'neutral' };

export function overviewTiles(config: OverviewConfig, s: RepoStats): { key: string; value: ReactNode; label: string; tone: Tone }[] {
  const all: { key: string; value: ReactNode; tone: Tone }[] = [
    { key: 'stars', value: s.stars, tone: 'neutral' },
    { key: 'forks', value: s.forks, tone: 'neutral' },
    { key: 'issues', value: s.issues, tone: 'neutral' },
    { key: 'prs', value: s.prs, tone: 'neutral' },
    { key: 'watchers', value: s.watchers, tone: 'neutral' },
    { key: 'push', value: s.pushedAt ? relTime(s.pushedAt) : '-', tone: 'neutral' },
    { key: 'ci', value: s.ci === 'none' ? '-' : tKey(`dash.github.ci.${s.ci}`), tone: CI_TONE[s.ci] ?? 'neutral' },
  ];
  return all.filter((t) => hasColumn(config, 'show', t.key)).map((t) => ({ ...t, label: tKey(`dash.github.stat.${t.key}`) }));
}

export function RepoOverviewPanel({ config, data }: { config: OverviewConfig; data: RepoStats | undefined }) {
  if (!data) return <div className="gh" />;
  return (
    <div className="gh">
      <div className="gh-tiles">
        {overviewTiles(config, data).map((t) => (
          <StatTile key={t.key} value={t.value} label={t.label} tone={t.tone} />
        ))}
      </div>
    </div>
  );
}
