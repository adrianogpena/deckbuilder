import { tKey } from '../../i18n';
import { hasColumn, ListRows, relTime, type ListRow } from '../../kit';
import './github.css';
import type { NotificationItem } from './more';

export interface NotificationsConfig {
  columns: string[];
  [key: string]: unknown;
}

export function notificationRows(config: NotificationsConfig, items: readonly NotificationItem[]): ListRow[] {
  const has = (c: string) => hasColumn(config, 'columns', c);
  return items.map((n) => ({
    id: n.id,
    title: n.title,
    href: n.url,
    meta: [has('repo') ? n.repo : '', has('type') ? n.type : '', has('reason') ? n.reason.replace(/_/g, ' ') : ''].filter(Boolean),
    trailing: has('updated') ? relTime(n.updatedAt) : undefined,
  }));
}

export function NotificationsPanel({ config, data }: { config: NotificationsConfig; data: { items: NotificationItem[] } | undefined }) {
  return (
    <div className="gh">
      <ListRows rows={notificationRows(config, data?.items ?? [])} empty={tKey('dash.github.notifications.empty')} />
    </div>
  );
}
