import { tKey } from '../../i18n';
import { Chip, hasColumn, ListRows, relTime, type ListRow } from '../../kit';
import './github.css';
import type { IssueItem, SearchData } from './map';

export interface IssuesConfig {
  columns: string[];
  density?: string;
  [key: string]: unknown;
}

export function issueRows(config: IssuesConfig, items: readonly IssueItem[]): ListRow[] {
  const has = (c: string) => hasColumn(config, 'columns', c);
  return items.map((i) => {
    const meta = [
      has('repo') ? `${i.repo}#${i.number}` : `#${i.number}`,
      has('author') ? i.author : '',
      has('assignees') ? i.assignees.join(', ') : '',
      has('milestone') ? i.milestone : '',
      has('comments') && i.comments > 0 ? tKey('dash.github.comments', { n: i.comments }) : '',
    ].filter(Boolean);
    const chip = has('labels') && i.labels.length > 0 ? <span className="gh-chips">{i.labels.map((l) => <Chip key={l} tone="info">{l}</Chip>)}</span> : undefined;
    if (config.density === 'compact') return { id: i.id, title: `#${i.number} ${i.title}`, href: i.url, chip };
    return { id: i.id, title: i.title, href: i.url, chip, meta, trailing: has('updated') ? relTime(i.updatedAt) : undefined };
  });
}

export function IssuesPanel({ config, data }: { config: IssuesConfig; data: SearchData<IssueItem> | undefined }) {
  return (
    <div className={config.density === 'compact' ? 'gh gh-compact' : 'gh'}>
      <div className="gh-head muted">{tKey('dash.github.count', { n: data?.total ?? 0 })}</div>
      <ListRows rows={issueRows(config, data?.items ?? [])} empty={tKey('dash.github.empty')} />
    </div>
  );
}
