import { useState } from 'react';
import { t } from '../i18n';
import type { AgentRunning } from './api';

export interface RecoveryBannerProps {
  items: AgentRunning[];
  onResume(items: AgentRunning[]): void;
  onDismiss(): void;
}

/** "N sessions were running": resume them all, pick which, or dismiss. */
export function RecoveryBanner({ items, onResume, onDismiss }: RecoveryBannerProps) {
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.map((x) => x.id)));
  if (items.length === 0) return null;
  const toggle = (id: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  return (
    <div className="agents-recovery" role="region" aria-label={t('agents.recovery.title', { n: items.length })}>
      <strong>{t('agents.recovery.title', { n: items.length })}</strong>
      {picking && (
        <ul className="agents-recovery-list">
          {items.map((x) => (
            <li key={x.id}>
              <label>
                <input type="checkbox" checked={chosen.has(x.id)} onChange={() => toggle(x.id)} />
                {x.title || x.id} ({t(`agents.mode.${x.mode}`)})
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="agents-recovery-actions">
        {picking ? (
          <>
            <button type="button" disabled={chosen.size === 0} onClick={() => onResume(items.filter((x) => chosen.has(x.id)))}>{t('agents.recovery.resume')}</button>
            <button type="button" onClick={() => setPicking(false)}>{t('agents.recovery.back')}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onResume(items)}>{t('agents.recovery.resumeAll')}</button>
            <button type="button" onClick={() => setPicking(true)}>{t('agents.recovery.pick')}</button>
          </>
        )}
        <button type="button" onClick={onDismiss}>{t('agents.recovery.dismiss')}</button>
      </div>
    </div>
  );
}
