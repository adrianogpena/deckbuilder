import { useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, type ContextMenuItem, fuzzyScore, highlightRuns, useRovingList, useToast } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import { type AgentAccountUsage, type AgentProject, type AgentRateLimit, type AgentSessionView, type AgentStatus, patchSessionState, searchSessions } from './api';
import { compareSessions, displayName } from './attention';

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

const STATUSES: AgentStatus[] = ['needs-you', 'error', 'running', 'done', 'idle', 'stopped'];

/** How a session matched the search: fuzzy name positions, or a full-text snippet. */
interface RowMatch {
  positions?: number[];
  snippet?: string;
}

/** Projects with their Claude sessions, a status dot and label per session; search, status chips, pin, rename and archive. */
export function Sidebar({ projects, sessions, usage = [], selectedId, onSelect, onNewSession, onAddProject, onRemoveProject }: SidebarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingList(ref, '.agents-session');
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [fullToggle, setFullToggle] = useState(false);
  const [filter, setFilter] = useState<ReadonlySet<AgentStatus>>(new Set());
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; session: AgentSessionView }>();
  const [renaming, setRenaming] = useState<string>();
  const renamingRef = useRef<string | undefined>(undefined);
  const [hits, setHits] = useState<ReadonlyMap<string, string>>(new Map());

  const prefixed = query.startsWith('?');
  const full = fullToggle || prefixed;
  const q = (prefixed ? query.slice(1) : query).trim();
  const searching = q !== '' || filter.size > 0;

  useEffect(() => {
    setHits(new Map());
    if (!full || !q) return;
    const ac = new AbortController();
    const found = new Map<string, string>();
    const timer = setTimeout(() => {
      searchSessions(q, (h) => {
        found.set(h.sessionId, h.snippet);
        setHits(new Map(found));
      }, ac.signal).catch(() => {
        if (!ac.signal.aborted) toast({ message: t('agents.search.failed'), kind: 'error' });
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [full, q, toast]);

  const { groups, archived } = useMemo(() => {
    const known = new Set(projects.map((p) => p.id));
    const matches = new Map<string, RowMatch>();
    for (const s of sessions) {
      if (filter.size && !filter.has(s.status)) continue;
      if (!q) matches.set(s.id, {});
      else if (full) {
        const snippet = hits.get(s.id);
        if (snippet !== undefined) matches.set(s.id, { snippet });
      } else {
        const m = fuzzyScore(q, displayName(s));
        if (m) matches.set(s.id, { positions: m.positions });
      }
    }
    const sorted = sessions.filter((s) => matches.has(s.id) && !!s.project && known.has(s.project)).sort(compareSessions);
    const live = sorted.filter((s) => !s.archived);
    return {
      groups: [...projects]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ project: p, list: live.filter((s) => s.project === p.id).map((s) => ({ s, m: matches.get(s.id)! })) }))
        .filter((g) => !searching || g.list.length > 0),
      archived: sorted.filter((s) => s.archived).map((s) => ({ s, m: matches.get(s.id)! })),
    };
  }, [projects, sessions, filter, q, full, hits, searching]);

  const present = useMemo(() => new Set(sessions.map((s) => s.status)), [sessions]);
  const chips = STATUSES.filter((st) => present.has(st) || filter.has(st));

  const toggleFilter = (st: AgentStatus) =>
    setFilter((f) => {
      const next = new Set(f);
      if (!next.delete(st)) next.add(st);
      return next;
    });

  const update = (id: string, state: Parameters<typeof patchSessionState>[1]) => {
    patchSessionState(id, state).catch(() => toast({ message: t('agents.stateFailed'), kind: 'error' }));
  };

  const startRename = (id: string) => {
    renamingRef.current = id;
    setRenaming(id);
  };

  const commitRename = (s: AgentSessionView, value: string) => {
    if (renamingRef.current !== s.id) return;
    renamingRef.current = undefined;
    setRenaming(undefined);
    const v = value.trim();
    if (v === (s.name || s.title)) return;
    update(s.id, { name: v === '' || v === s.title ? null : v });
  };

  const menuItems = (s: AgentSessionView): Array<ContextMenuItem | 'sep'> => [
    { id: 'pin', label: s.pinned ? t('agents.unpin') : t('agents.pin'), run: () => update(s.id, { pinned: !s.pinned }) },
    // Deferred so the menu gives the focus back before the rename input takes it.
    { id: 'rename', label: t('agents.rename'), hint: 'F2', run: () => setTimeout(() => startRename(s.id), 0) },
    'sep',
    { id: 'archive', label: s.archived ? t('agents.unarchive') : t('agents.archive'), run: () => update(s.id, { archived: !s.archived }) },
  ];

  const row = ({ s, m }: { s: AgentSessionView; m: RowMatch }) => {
    const label = statusLabel(s.status);
    const name = displayName(s);
    if (renaming === s.id) {
      return (
        <div key={s.id} className="agents-session-edit">
          <span className={`agents-dot ${s.status}`} role="img" title={label} aria-label={label} />
          <input
            className="agents-rename"
            autoFocus
            defaultValue={s.name || s.title}
            aria-label={t('agents.rename.label')}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename(s, e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                renamingRef.current = undefined;
                setRenaming(undefined);
              }
            }}
            onBlur={(e) => commitRename(s, e.currentTarget.value)}
          />
        </div>
      );
    }
    const use = sessionUsage(s);
    return (
      <button
        key={s.id}
        type="button"
        className={`agents-session${s.id === selectedId ? ' selected' : ''}${s.pinned ? ' pinned' : ''}`}
        aria-current={s.id === selectedId ? 'true' : undefined}
        onClick={() => onSelect(s.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ at: { x: e.clientX, y: e.clientY }, session: s });
        }}
        onKeyDown={(e) => {
          if (e.key !== 'F2') return;
          e.preventDefault();
          startRename(s.id);
        }}
      >
        <span className={`agents-dot ${s.status}`} role="img" title={label} aria-label={label} />
        <span className="agents-session-text">
          <span className="agents-session-title" title={name}>
            {s.pinned && <span className="agents-pin" role="img" title={t('agents.pinned')} aria-label={t('agents.pinned')} />}
            {m.positions ? highlightRuns(name, m.positions).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : r.text)) : name}
          </span>
          {m.snippet && <span className="agents-session-snippet" title={m.snippet}>{m.snippet}</span>}
          {use && <span className="agents-session-usage" title={use.title}>{use.line}</span>}
        </span>
        <span className="agents-status">{s.external ? `${label} · ${t('agents.external')}` : label}</span>
      </button>
    );
  };

  const archivedShown = archivedOpen || searching;
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
      {sessions.length > 0 && (
        <div className="agents-find">
          <div className="agents-search">
            <input
              type="search"
              value={query}
              placeholder={t('agents.search.placeholder')}
              aria-label={t('agents.search')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  setQuery('');
                }
              }}
            />
            <button
              type="button"
              className="agents-search-mode"
              aria-pressed={full}
              title={t('agents.search.fullText')}
              aria-label={t('agents.search.fullText')}
              onClick={() => {
                if (prefixed) {
                  setQuery(query.slice(1));
                  setFullToggle(false);
                } else setFullToggle((v) => !v);
              }}
            >?</button>
          </div>
          {chips.length > 1 && (
            <div className="agents-chips" role="group" aria-label={t('agents.filter')}>
              {chips.map((st) => (
                <button key={st} type="button" className="agents-chip" aria-pressed={filter.has(st)} onClick={() => toggleFilter(st)}>
                  <span className={`agents-dot ${st}`} aria-hidden="true" />
                  {statusLabel(st)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {projects.length === 0 && (
        <p className="agents-empty">
          {t('agents.empty')}. {t('agents.emptyHint')}
        </p>
      )}
      {searching && groups.length === 0 && archived.length === 0 && <p className="agents-empty">{t('agents.noMatches')}</p>}
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
          {list.map(row)}
        </section>
      ))}
      {archived.length > 0 && (
        <section className="agents-project agents-archived">
          <header>
            <button type="button" className="agents-archived-toggle" aria-expanded={archivedShown} onClick={() => setArchivedOpen((v) => !v)}>
              <span aria-hidden="true">{archivedShown ? '▾' : '▸'}</span> {t('agents.archived')} ({archived.length})
            </button>
          </header>
          {archivedShown && archived.map(row)}
        </section>
      )}
      {menu && <ContextMenu at={menu.at} items={menuItems(menu.session)} onClose={() => setMenu(undefined)} />}
    </nav>
  );
}
