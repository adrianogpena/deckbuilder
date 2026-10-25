import { Button, Icon } from '@kedalion/ui';
import { t } from '../../i18n';

/** The center of a project with no session selected: start a Claude session. */
export function EmptyCard({ onNewSession }: { onNewSession(): void }) {
  return (
    <div className="agents-dock-card">
      <span className="agents-dock-card-icon" aria-hidden><Icon name="terminal" size={28} /></span>
      <h2 className="agents-dock-card-title">{t('workspace.empty.title')}</h2>
      <p className="agents-dock-card-desc">{t('workspace.empty.desc')}</p>
      <div className="agents-dock-card-actions">
        <Button variant="primary" icon="plus" onClick={onNewSession}>{t('workspace.empty.newSession')}</Button>
      </div>
    </div>
  );
}
