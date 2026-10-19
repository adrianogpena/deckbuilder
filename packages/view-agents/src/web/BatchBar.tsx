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
          <button key={a.id} type="button" title={a.label} className={`btn btn-sm${a.danger ? ' danger' : ''}`} onClick={a.run}>{a.label}</button>
        ))}
        <button type="button" title={t('agents.batch.clear')} className="btn btn-sm" onClick={onClear}>{t('agents.batch.clear')}</button>
      </span>
    </div>
  );
}
