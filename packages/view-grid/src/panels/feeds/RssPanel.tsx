import { Button } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { ListRows, relTime, type ListRow } from '../../kit';
import './feeds.css';
import { feedUrls, type FeedItem } from './rss';

export interface RssConfig {
  urls: string;
  max: number;
  showSummary: boolean;
  showSource: boolean;
  [key: string]: unknown;
}

const clip = (text: string, n = 160): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function RssPanel({ config, items, configure }: { config: RssConfig; items: readonly FeedItem[] | undefined; configure: () => void }) {
  if (feedUrls(config.urls).length === 0) {
    return (
      <div className="kit-empty">
        <p>{tKey('dash.feeds.rss.none')}</p>
        <Button size="sm" variant="primary" icon="settings" onClick={configure}>{tKey('grid.setUp')}</Button>
      </div>
    );
  }
  const now = Date.now();
  const rows: ListRow[] = (items ?? []).map((item, i) => ({
    id: `${i}-${item.link}`,
    title: item.title,
    href: /^https?:\/\//i.test(item.link) ? item.link : undefined,
    meta: [config.showSource ? item.source : '', item.date ? relTime(item.date, now) : '', config.showSummary ? clip(item.summary) : ''].filter(Boolean),
  }));
  return <ListRows rows={rows} empty={tKey('dash.feeds.rss.empty')} />;
}
