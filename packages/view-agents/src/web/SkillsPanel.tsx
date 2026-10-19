import { useRef, useState } from 'react';
import { Empty, ErrorBanner, Icon, Spinner, useAsync, useRovingList } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { AgentSkillState } from '../protocol';
import { listSkills } from './api';

const GROUPS: readonly AgentSkillState[] = ['on', 'name-only', 'user-invocable-only', 'off'];

export interface SkillsPanelProps {
  onClose(): void;
}

/** Skills and Agents of the active account, as a scrolling page in the center. */
export function SkillsPanel({ onClose }: SkillsPanelProps) {
  const [tab, setTab] = useState<'skills' | 'agents'>('skills');
  const state = useAsync(listSkills, []);
  const listRef = useRef<HTMLDivElement>(null);
  useRovingList(listRef, '.agents-skills-row');
  const data = state.data;
  return (
    <div className="agents-skills-page">
      <div className="agents-skills-bar">
        <h3>{t('agents.skills')}</h3>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>
      <div className="agents-skills">
        <div className="agents-skills-tabs" role="tablist">
          {(['skills', 'agents'] as const).map((k) => (
            <button key={k} type="button" role="tab" title={t(`agents.skills.tab.${k}`)} aria-selected={tab === k} className="agents-skills-tab" onClick={() => setTab(k)}>
              {t(`agents.skills.tab.${k}`)}
            </button>
          ))}
        </div>
        {state.error && <ErrorBanner error={state.error} onRetry={state.reload} />}
        {!state.error && !data && (
          <div className="agents-skills-loading">
            <Spinner />
          </div>
        )}
        {data && (
          <div ref={listRef}>
            {tab === 'skills' && data.skills.length === 0 && <Empty title={t('agents.skills.empty')} />}
            {tab === 'skills' &&
              GROUPS.map((g) => {
                const rows = data.skills.filter((s) => s.state === g);
                if (rows.length === 0) return null;
                return (
                  <section key={g} aria-label={t(`agents.skills.group.${g}`)}>
                    <div className="agents-skills-head">
                      <span className="mono-label">{t(`agents.skills.group.${g}`)}</span>
                      <span className="mono-label">{rows.length}</span>
                    </div>
                    <ul className="agents-skills-list">
                      {rows.map((s) => (
                        <li key={s.name} className="agents-skills-row" tabIndex={-1}>
                          <span className="agents-skills-name">{s.name}</span>
                          <span className="agents-skills-desc" title={s.description}>{s.description}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            {tab === 'agents' && data.agents.length === 0 && <Empty title={t('agents.skills.agentsEmpty')} />}
            {tab === 'agents' && data.agents.length > 0 && (
              <ul className="agents-skills-list">
                {data.agents.map((a) => (
                  <li key={a.name} className="agents-skills-row" tabIndex={-1}>
                    <span className="agents-skills-name">{a.name}</span>
                    <span className="agents-skills-desc" title={a.description}>{a.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
