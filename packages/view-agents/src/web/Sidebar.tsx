import { useMemo, useRef } from 'react';
import { useRovingList } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { AgentProject, AgentSessionView, AgentStatus } from './api';
import { compareSessions } from './attention';

export interface SidebarProps {
  projects: AgentProject[];
  sessions: AgentSessionView[];
  selectedId?: string;
  onSelect(sessionId: string): void;
  /** Called with the project id. */
  onNewSession(projectId: string): void;
  onAddProject(): void;
  onRemoveProject(projectId: string): void;
}

export function statusLabel(s: AgentStatus): string {
  switch (s) {
    case 'error': return t('agents.status.error');
    case 'needs-you': return t('agents.status.needs-you');
    case 'running': return t('agents.status.running');
    case 'done': return t('agents.status.done');
    case 'idle': return t('agents.status.idle');
    default: return t('agents.status.stopped');
  }
}

/** Projects with their Claude sessions, a status dot and label per session. */
export function Sidebar({ projects, sessions, selectedId, onSelect, onNewSession, onAddProject, onRemoveProject }: SidebarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingList(ref, '.agents-session');
  const groups = useMemo(() => {
    const sorted = [...sessions].sort(compareSessions);
    return [...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ project: p, list: sorted.filter((s) => s.project === p.id) }));
  }, [projects, sessions]);
  return (
    <nav className="agents-sidebar" aria-label={t('agents.sidebar')} ref={ref}>
      <div className="agents-sidebar-head">
        <button type="button" onClick={onAddProject}>{t('agents.add.button')}</button>
      </div>
      {groups.length === 0 && (
        <p className="agents-empty">
          {t('agents.empty')}. {t('agents.emptyHint')}
        </p>
      )}
      {groups.map(({ project, list }) => (
        <section key={project.id} className="agents-project">
          <header>
            <h3 title={project.path}>{project.name}</h3>
            <span>
              <button type="button" className="agents-remove" title={t('agents.remove')} aria-label={t('agents.remove')} onClick={() => onRemoveProject(project.id)}>x</button>
              <button type="button" className="agents-new" title={t('agents.new.title')} aria-label={t('agents.new.title')} onClick={() => onNewSession(project.id)}>+</button>
            </span>
          </header>
          {list.length === 0 && <p className="agents-empty">{t('agents.noSessions')}</p>}
          {list.map((s) => {
            const label = statusLabel(s.status);
            return (
              <button
                key={s.id}
                type="button"
                className={`agents-session${s.id === selectedId ? ' selected' : ''}`}
                aria-current={s.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(s.id)}
              >
                <span className={`agents-dot ${s.status}`} role="img" title={label} aria-label={label} />
                <span className="agents-session-title">{s.title || s.firstPrompt || s.id.slice(0, 8)}</span>
                <span className="agents-status">{s.external ? `${label} · ${t('agents.external')}` : label}</span>
              </button>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
