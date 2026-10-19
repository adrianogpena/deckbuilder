import type { ReactNode } from 'react';
import { Icon } from '@deckbuilderkit/ui';
import { t } from '../i18n';

/** Bar under a stopped session (spec S8): history icon, title, Resume and Dismiss. Never runs by itself. `children` replaces the title (recovery list). */
export function ResumeBar({ title, onResume, onDismiss, actions, children }: { title?: string; onResume?(): void; onDismiss(): void; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="agents-bar agents-resume-bar" role="region" aria-label={title ?? t('agents.resumeBar.title')}>
      <span className="agents-resume-icon" aria-hidden><Icon name="history" size={14} /></span>
      <div className="agents-bar-text">{children ?? title ?? t('agents.resumeBar.title')}</div>
      {actions ?? (onResume && <button type="button" className="agents-bar-btn is-primary" title={t('agents.resumeBar.resume')} onClick={onResume}>{t('agents.resumeBar.resume')}</button>)}
      <button type="button" className="agents-bar-btn" title={t('agents.resumeBar.dismiss')} onClick={onDismiss}>{t('agents.resumeBar.dismiss')}</button>
    </div>
  );
}
