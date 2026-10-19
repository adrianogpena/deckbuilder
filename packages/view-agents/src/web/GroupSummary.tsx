import type { KeyboardEvent } from 'react';
import type { AgentSessionView } from '../protocol.ts';
import { t } from '../i18n';
import { since } from './AlertsPanel';
import { displayName, statusCounts } from './attention';
import { statusLabel } from './Sidebar';
import { shortCwd } from './StoppedCard';
import { StatusDot } from './StatusDot';
import './main.css';

export interface GroupSummaryProps {
  kind: 'project' | 'folder';
  name: string;
  /** Project folder; shown with `~` on the meta line of a project. */
  path?: string;
  /** The group's sessions after the sidebar filters. */
  sessions: AgentSessionView[];
  /** Projects in a folder; shown instead of the path. */
  projectCount?: number;
  onSelect(sessionId: string): void;
  /** Enter on the summary; absent for folders. */
  onNewSession?(): void;
}

/** Summary of a project or folder row: kind and name, counts, a hint and one line per session, newest first. */
export function GroupSummary({ kind, name, path, sessions, projectCount, onSelect, onNewSession }: GroupSummaryProps) {
  const c = statusCounts(sessions);
  const meta = [
    t(sessions.length === 1 ? 'agents.summary.session' : 'agents.summary.sessions', { n: sessions.length }),
    t('agents.summary.running', { n: c.running }),
    t('agents.summary.waiting', { n: c.waiting }),
    kind === 'folder'
      ? t(projectCount === 1 ? 'agents.summary.project' : 'agents.summary.projects', { n: projectCount ?? 0 })
      : path && shortCwd(path),
  ].filter(Boolean);
  const list = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.target !== e.currentTarget || !onNewSession) return;
    e.preventDefault();
    onNewSession();
  };

  return (
    <div className="agents-summary-card" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="agents-summary-head">
        <span className={`agents-summary-name ${kind}`}>
          {t(kind === 'folder' ? 'agents.summary.folder' : 'agents.summary.projectKind')} · {name}
        </span>
        <span className="agents-summary-meta">{meta.join(' · ')}</span>
      </div>
      <div className="agents-summary-hint">{t(onNewSession ? 'agents.summary.hint' : 'agents.summary.hintFolder')}</div>
      {list.length === 0 && <p className="agents-empty">{t('agents.noSessions')}</p>}
      <ul className="agents-summary-list">
        {list.map((s) => {
          const label = statusLabel(s.status);
          const title = displayName(s);
          return (
            <li key={s.id}>
              <button type="button" className="agents-summary-row" title={title} onClick={() => onSelect(s.id)}>
                <StatusDot status={s.status} title={label} />
                <span className="agents-summary-title" title={title}>{title}</span>
                <span className="agents-summary-time">{since(s.updatedAt)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
