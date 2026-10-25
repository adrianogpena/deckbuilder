import { Button } from '@kedalion/ui';
import { t } from '../i18n';

/** One batch action button; later batches (archive, delete) append entries. */
export interface BatchAction {
  id: string;
  label: string;
  run(): void;
  danger?: boolean;
}

export interface BatchBarProps {
  count: number;
  actions: BatchAction[];
  onClear(): void;
}

/** Dense bar at the sidebar bottom while sessions are checked: count left, actions and Clear right. */
export function BatchBar({ count, actions, onClear }: BatchBarProps) {
  return (
    <div className="agents-batch" role="toolbar" aria-label={t('agents.batch.label')}>
      <span className="agents-batch-count">{t('agents.note.selected', { count: String(count) })}</span>
      <span className="agents-batch-actions">
        {actions.map((a) => (
          <Button key={a.id} size="sm" variant={a.danger ? 'danger' : 'default'} title={a.label} onClick={a.run}>{a.label}</Button>
        ))}
        <Button size="sm" variant="ghost" icon="close" title={t('agents.batch.clear')} onClick={onClear}>{t('agents.batch.clear')}</Button>
      </span>
    </div>
  );
}
