import { tKey } from '../../i18n';
import { Chip, ListRows, relTime, type ListRow } from '../../kit';
import './github.css';
import type { ReleaseItem } from './more';

export interface ReleasesConfig {
  [key: string]: unknown;
}

export function releaseRows(items: readonly ReleaseItem[]): ListRow[] {
  return items.map((r) => ({
    id: r.id,
    title: r.name,
    href: r.url,
    chip: r.prerelease ? <Chip tone="warn">{tKey('dash.github.prerelease')}</Chip> : undefined,
    meta: r.name !== r.tag ? [r.tag] : [],
    trailing: r.publishedAt ? relTime(r.publishedAt) : undefined,
  }));
}

export function ReleasesPanel({ data }: { data: { items: ReleaseItem[] } | undefined }) {
  return (
    <div className="gh">
      <ListRows rows={releaseRows(data?.items ?? [])} empty={tKey('dash.github.empty')} />
    </div>
  );
}
