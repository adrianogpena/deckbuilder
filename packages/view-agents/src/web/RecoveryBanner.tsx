import { useState } from 'react';
import { Button } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { AgentRunning } from './api';
import { ResumeBar } from './ResumeBar';

export interface RecoveryBannerProps {
  items: AgentRunning[];
  onResume(items: AgentRunning[]): void;
  onDismiss(): void;
}

/** "N sessions were running", in the resume bar look: resume them all, pick which, or dismiss. */
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
  const actions = picking ? (
    <>
      <Button variant="primary" size="xs" icon="play" title={t('agents.recovery.resume')} disabled={chosen.size === 0} onClick={() => onResume(items.filter((x) => chosen.has(x.id)))}>{t('agents.recovery.resume')}</Button>
      <Button size="xs" title={t('agents.recovery.back')} onClick={() => setPicking(false)}>{t('agents.recovery.back')}</Button>
    </>
  ) : (
    <>
      <Button variant="primary" size="xs" icon="play" title={t('agents.recovery.resumeAll')} onClick={() => onResume(items)}>{t('agents.recovery.resumeAll')}</Button>
      <Button size="xs" title={t('agents.recovery.pick')} onClick={() => setPicking(true)}>{t('agents.recovery.pick')}</Button>
    </>
  );
  return (
    <ResumeBar title={t('agents.recovery.title', { n: items.length })} actions={actions} onDismiss={onDismiss}>
      <strong>{t('agents.recovery.title', { n: items.length })}</strong>
      {picking && (
        <ul className="agents-recovery-list">
          {items.map((x) => (
            <li key={x.id}>
              <label>
                <input type="checkbox" checked={chosen.has(x.id)} onChange={() => toggle(x.id)} />
                {x.title || x.id}
              </label>
            </li>
          ))}
        </ul>
      )}
    </ResumeBar>
  );
}
