import { useMemo, useRef } from 'react';
import { useRovingList } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { AgentAccountUsage, AgentProject, AgentRateLimit, AgentSessionView, AgentStatus } from './api';
import { compareSessions } from './attention';

export interface SidebarProps {
  projects: AgentProject[];
  sessions: AgentSessionView[];
  /** Plan usage per account; accounts without known rate limits are absent. */
  usage?: AgentAccountUsage[];
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

/** Compact token count: 950, 12.3k, 1.2M. */
export function compactTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** The quiet usage line of a session row and its breakdown tooltip; undefined when nothing is known. */
function sessionUsage(s: AgentSessionView): { line: string; title: string } | undefined {
  const parts: string[] = [];
  const lines: string[] = [];
  if (s.contextPercent !== undefined) {
    parts.push(`${s.contextPercent}% ${t('agents.context')}`);
    lines.push(`${t('agents.context')}: ${s.contextPercent}%`);
  }
  const tk = s.tokens;
  if (tk) {
    parts.push(`${compactTokens(tk.input)} ${t('agents.tokens.in')}`, `${compactTokens(tk.output)} ${t('agents.tokens.out')}`, `${compactTokens(tk.cacheCreation + tk.cacheRead)} ${t('agents.tokens.cache')}`);
    const fmt = (n: number) => n.toLocaleString();
    lines.push(
      `${t('agents.tokens.input')}: ${fmt(tk.input)}`,
      `${t('agents.tokens.output')}: ${fmt(tk.output)}`,
      `${t('agents.tokens.cacheCreation')}: ${fmt(tk.cacheCreation)}`,
      `${t('agents.tokens.cacheRead')}: ${fmt(tk.cacheRead)}`,
    );
  }
  return parts.length ? { line: parts.join(' · '), title: lines.join('\n') } : undefined;
}

function UsageBar({ label, limit }: { label: string; limit?: AgentRateLimit }) {
  if (!limit) return null;
  const pct = Math.round(limit.percent);
  const reset = limit.resetsAt ? ` · ${t('agents.usage.resets')} ${new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
  return (
    <div className="agents-usage-bar" title={`${label}: ${pct}%${reset}`}>
      <span>{label}</span>
      <span className="agents-usage-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className={`agents-usage-fill${pct >= 100 ? ' full' : pct >= 80 ? ' high' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="agents-usage-pct">{pct}%</span>
    </div>
  );
}

/** Projects with their Claude sessions, a status dot and label per session. */
export function Sidebar({ projects, sessions, usage = [], selectedId, onSelect, onNewSession, onAddProject, onRemoveProject }: SidebarProps) {
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
      {usage.length > 0 && (
        <section className="agents-usage" aria-label={t('agents.usage')}>
          {usage.map((u) => (
            <div key={u.account} className="agents-usage-account">
              <span className="agents-usage-name" title={t('agents.usage')}>{u.label}</span>
              <UsageBar label={t('agents.usage.fiveHour')} limit={u.fiveHour} />
              <UsageBar label={t('agents.usage.sevenDay')} limit={u.sevenDay} />
            </div>
          ))}
        </section>
      )}
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
            const use = sessionUsage(s);
            return (
              <button
                key={s.id}
                type="button"
                className={`agents-session${s.id === selectedId ? ' selected' : ''}`}
                aria-current={s.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(s.id)}
              >
                <span className={`agents-dot ${s.status}`} role="img" title={label} aria-label={label} />
                <span className="agents-session-text">
                  <span className="agents-session-title">{s.title || s.firstPrompt || s.id.slice(0, 8)}</span>
                  {use && <span className="agents-session-usage" title={use.title}>{use.line}</span>}
                </span>
                <span className="agents-status">{s.external ? `${label} · ${t('agents.external')}` : label}</span>
              </button>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
