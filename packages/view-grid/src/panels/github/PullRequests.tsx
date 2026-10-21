import { tKey } from '../../i18n';
import { Chip, hasColumn, ListRows, relTime, type ListRow, type Tone } from '../../kit';
import './github.css';
import type { PrItem, SearchData } from './map';

export interface PullRequestsConfig {
  columns: string[];
  density?: string;
  [key: string]: unknown;
}

const REVIEW_TONE: Record<string, Tone> = { approved: 'ok', changes: 'danger', required: 'warn' };
const CI_TONE: Record<string, Tone> = { pass: 'ok', fail: 'danger', pending: 'warn' };

export function prRows(config: PullRequestsConfig, items: readonly PrItem[]): ListRow[] {
  const has = (c: string) => hasColumn(config, 'columns', c);
  return items.map((pr) => {
    const chip = (
      <span className="gh-chips">
        {pr.draft && <Chip>{tKey('dash.github.draft')}</Chip>}
        {has('review') && pr.review !== 'none' && <Chip tone={REVIEW_TONE[pr.review]}>{tKey(`dash.github.review.${pr.review}`)}</Chip>}
        {has('checks') && pr.ci !== 'none' && (
          <Chip tone={CI_TONE[pr.ci]} title={pr.failing.length ? tKey('dash.github.ci.failing', { names: pr.failing.join(', ') }) : undefined}>
            {tKey(`dash.github.ci.${pr.ci}`)}
          </Chip>
        )}
        {has('ticket') && pr.ticket && <Chip tone="info">{pr.ticket}</Chip>}
      </span>
    );
    const meta = [
      has('repo') ? `${pr.repo}#${pr.number}` : `#${pr.number}`,
      has('author') ? pr.author : '',
      has('branch') ? pr.branch : '',
      has('labels') ? pr.labels.join(', ') : '',
    ].filter(Boolean);
    if (config.density === 'compact') return { id: pr.id, title: `#${pr.number} ${pr.title}`, href: pr.url, chip };
    return { id: pr.id, title: pr.title, href: pr.url, chip, meta, trailing: has('updated') ? relTime(pr.updatedAt) : undefined };
  });
}

export function PullRequestsPanel({ config, data }: { config: PullRequestsConfig; data: SearchData<PrItem> | undefined }) {
  const items = data?.items ?? [];
  return (
    <div className={config.density === 'compact' ? 'gh gh-compact' : 'gh'}>
      <div className="gh-head muted">{tKey('dash.github.count', { n: data?.total ?? 0 })}</div>
      <ListRows rows={prRows(config, items)} empty={tKey('dash.github.empty')} />
    </div>
  );
}
