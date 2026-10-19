import { Icon, useShortcutTip } from '@deckbuilderkit/ui';
import { t } from '../i18n';

/** Main pane with nothing selected (spec S11): icon, title, description with the new-session key, "New session" button. */
export function EmptyState({ newKey, onNewSession }: { newKey?: string; onNewSession?(): void }) {
  const tip = useShortcutTip();
  const [before, after] = t('agents.empty.desc', { key: '\u0000' }).split('\u0000');
  return (
    <div className="agents-empty-state">
      <span className="agents-empty-icon" aria-hidden><Icon name="terminal" size={28} /></span>
      <h2 className="agents-empty-title">{t('agents.empty.title')}</h2>
      <p className="agents-empty-desc">
        {newKey ? <>{before}<kbd className="agents-keycap">{newKey}</kbd>{after}</> : t('agents.pick')}
      </p>
      {onNewSession && <button type="button" className="agents-empty-btn" title={tip(t('agents.empty.newSession'), 'agents.newSession')} onClick={onNewSession}>{t('agents.empty.newSession')}</button>}
    </div>
  );
}
