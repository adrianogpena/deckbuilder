import { useRef, useState } from 'react';
import { Empty, ErrorBanner, Spinner, type SidePanelContent, useAsync, useRovingList } from '@kedalion/ui';
import { t } from '../i18n';
import type { AgentDetails, AgentSkillState } from '../protocol';
import { listSkills } from './api';

const GROUPS: readonly AgentSkillState[] = ['on', 'name-only', 'user-invocable-only', 'off'];

export const SKILLS_PANEL_ID = 'agents-skills';

const Source = ({ source }: { source?: 'project' }) => (source ? <span className="badge badge-info">{t('agents.skills.project')}</span> : null);

const FIELDS = ['argument-hint', 'allowed-tools', 'tools', 'model'] as const;

/** A row: name, tag and one-line description; Enter or a click shows or hides the details below it. */
function Row({ name, description, source, details }: { name: string; description: string; source?: 'project'; details?: AgentDetails }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  return (
    <li className={`agents-skills-row${open ? ' open' : ''}`} tabIndex={-1} aria-expanded={open} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
      <span className="agents-skills-name">{name} <Source source={source} /></span>
      <span className="agents-skills-desc" title={description}>{description}</span>
      {open && details && (
        <dl className="agents-skills-details">
          {FIELDS.filter((k) => details.fields[k]).map((k) => (
            <div key={k}>
              <dt>{t(`agents.skills.field.${k}`)}</dt>
              <dd>{details.fields[k]}</dd>
            </div>
          ))}
          <div>
            <dt>{t('agents.skills.field.file')}</dt>
            <dd>{details.file}</dd>
          </div>
          {details.modified > 0 && (
            <div>
              <dt>{t('agents.skills.field.modified')}</dt>
              <dd>{new Date(details.modified).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

/** One tab of the skills side panel: the skills or the agents the folder sees (no folder: the global ones). */
function SkillsList({ kind, folder }: { kind: 'skills' | 'agents'; folder: string | undefined }) {
  const state = useAsync(() => listSkills(folder), [folder]);
  const listRef = useRef<HTMLDivElement>(null);
  useRovingList(listRef, '.agents-skills-row');
  const data = state.data;
  return (
    <div className="agents-skills">
      {state.error && <ErrorBanner error={state.error} onRetry={state.reload} />}
      {!state.error && !data && (
        <div className="agents-skills-loading">
          <Spinner />
        </div>
      )}
      {data && (
        <div ref={listRef}>
          {kind === 'skills' && data.skills.length === 0 && <Empty title={t('agents.skills.empty')} />}
          {kind === 'skills' &&
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
                      <Row key={s.name} name={s.name} description={s.description} source={s.source} details={s.details} />
                    ))}
                  </ul>
                </section>
              );
            })}
          {kind === 'agents' && data.agents.length === 0 && <Empty title={t('agents.skills.agentsEmpty')} />}
          {kind === 'agents' && data.agents.length > 0 && (
            <ul className="agents-skills-list">
              {data.agents.map((a) => (
                <Row key={a.name} name={a.name} description={a.description} source={a.source} details={a.details} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Side panel content for Skills and Agents; `folder` is read on every render, so the lists follow the focus. */
export function skillsSideContent(folder: () => string | undefined): SidePanelContent {
  return {
    id: SKILLS_PANEL_ID,
    title: t('agents.skills'),
    icon: 'bookmark',
    tabs: (['skills', 'agents'] as const).map((k) => ({ id: k, label: t(`agents.skills.tab.${k}`), render: () => <SkillsList key={k} kind={k} folder={folder()} /> })),
  };
}
