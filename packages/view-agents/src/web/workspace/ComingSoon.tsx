import { Icon, type IconName } from '@kedalion/ui';
import { type AgentsMessageKey, t } from '../../i18n';

/** Placeholder of a tool that is not built yet. */
export function ComingSoon({ titleKey, icon }: { titleKey: AgentsMessageKey; icon: IconName }) {
  return (
    <div className="agents-dock-card">
      <span className="agents-dock-card-icon" aria-hidden><Icon name={icon} size={28} /></span>
      <h2 className="agents-dock-card-title">{t(titleKey)}</h2>
      <p className="agents-dock-card-desc">{t('workspace.comingSoon')} — {t('workspace.comingSoon.desc')}</p>
    </div>
  );
}
