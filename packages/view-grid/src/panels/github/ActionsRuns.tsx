import { tKey } from '../../i18n';
import { Chip, fmtDuration, hasColumn, ListRows, relTime, type ListRow, type Tone } from '../../kit';
import './github.css';
import type { RunItem, RunsData } from './more';

export interface ActionsConfig {
  columns: string[];
  [key: string]: unknown;
}

const RUN_TONE: Record<string, Tone> = { success: 'ok', failure: 'danger', in_progress: 'warn', queued: 'info', cancelled: 'neutral', other: 'neutral' };

export function runRows(config: ActionsConfig, items: readonly RunItem[]): ListRow[] {
  const has = (c: string) => hasColumn(config, 'columns', c);
  return items.map((r) => {
    const meta = [has('branch') ? r.branch : '', has('event') ? r.event : '', has('actor') ? r.actor : '', has('duration') && r.status !== 'queued' ? fmtDuration(r.durationMs) : ''].filter(Boolean);
    return {
      id: r.id,
      title: r.title,
      href: r.url,
      chip: <Chip tone={RUN_TONE[r.status]}>{tKey(`dash.github.run.${r.status}`)}</Chip>,
      meta,
      trailing: has('updated') ? relTime(r.updatedAt) : undefined,
    };
  });
}

export function ActionsRunsPanel({ config, data }: { config: ActionsConfig; data: RunsData | undefined }) {
  return (
    <div className="gh">
      <ListRows rows={runRows(config, data?.items ?? [])} empty={tKey('dash.github.empty')} />
    </div>
  );
}
