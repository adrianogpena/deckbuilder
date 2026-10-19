import { Icon } from '@deckbuilderkit/ui';
import { t } from '../../i18n';

/** Shown for a saved tab whose kind this build does not have. */
export function MissingPanel({ kind }: { kind: string }) {
  return (
    <div className="agents-dock-card">
      <span className="agents-dock-card-icon" aria-hidden><Icon name="alert" size={28} /></span>
      <h2 className="agents-dock-card-title">{t('workspace.missing')}</h2>
      <p className="agents-dock-card-desc">{t('workspace.missing.desc', { kind })}</p>
    </div>
  );
}
