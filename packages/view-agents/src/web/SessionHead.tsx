import { useEffect, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName, useShortcutTip } from '@deckbuilderkit/ui';
import type { AgentSessionView } from '../protocol.ts';
import { t } from '../i18n';
import { displayName } from './attention';
import { Badge, type BadgeKind } from './Badge';
import { SessionDot } from './StatusIcon';
import { statusSince } from './status-text';
import './main.css';

export type SessionMode = 'terminal' | 'external';

/** Status badge of the head strip: kind and label (spec S7). */
export function headBadge(s: Pick<AgentSessionView, 'status' | 'lifecycle' | 'exitCode'>): { kind: BadgeKind; label: string } {
  if (s.lifecycle === 'exited' || s.status === 'exited') return { kind: 'danger', label: t('agents.badge.exited', { code: s.exitCode == null ? '?' : String(s.exitCode) }) };
  switch (s.status) {
    case 'running': return { kind: 'working', label: t('agents.badge.working') };
    case 'starting': return { kind: 'working', label: t('agents.badge.starting') };
    case 'needs-you': return { kind: 'waiting', label: t('agents.badge.waiting') };
    case 'error': return { kind: 'danger', label: t('agents.badge.error') };
    case 'done': return { kind: 'ok', label: t('agents.badge.done') };
    case 'idle': return { kind: 'neutral', label: t('agents.badge.idle') };
    default: return { kind: 'neutral', label: t('agents.badge.stopped') };
  }
}

export interface SessionHeadProps {
  session: AgentSessionView;
  mode: SessionMode;
  /** Project display name; the cwd folder when the session has no project. */
  project: string;
  git?: { branch?: string | null; dirty?: number; ahead?: number; behind?: number };
  onRename(name: string | null): void;
  onStop(): void;
  onRestart(): void;
  onCopy(): void;
  onTrajectory(): void;
  onTogglePanel(): void;
}

function HeadButton({ icon, label, onClick, command }: { icon: IconName; label: string; onClick(): void; command?: string }) {
  const tip = useShortcutTip();
  return (
    <button type="button" className="agents-head-btn" title={tip(label, command)} aria-label={label} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}

/** The 34px strip above the selected session (spec S7): dot, title (double-click renames), badges, "project — session", git, context, actions. */
export function SessionHead({ session: s, mode, project, git, onRename, onStop, onRestart, onCopy, onTrajectory, onTogglePanel }: SessionHeadProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setEditing(false), [s.id]);

  const title = displayName(s);
  const badge = headBadge(s);
  const running = (s.live === true || s.lifecycle === 'starting') && s.lifecycle !== 'exited';
  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name !== title) onRename(name || null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setEditing(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="agents-head">
      <SessionDot status={s.status} account={s.account} title={statusSince(s, now, t).text} />
      {editing ? (
        <input className="agents-head-rename" aria-label={t('agents.head.rename')} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} />
      ) : (
        <span className="agents-head-title" title={t('agents.head.rename')} onDoubleClick={() => { setDraft(title); setEditing(true); }}>{title}</span>
      )}
      <Badge kind={badge.kind}>{badge.label}</Badge>
      <Badge kind="neutral">{t(`agents.badge.${mode}`)}</Badge>
      {s.status === 'needs-you' && <span className="agents-head-bell" aria-hidden><Icon name="bell" size={12} /></span>}
      <span className="agents-head-sub" title={s.cwd}>{t('agents.head.title', { project, session: title })}</span>
      {git?.branch && (
        <span className="agents-head-git">
          <Icon name="git-branch" size={12} />
          {git.branch}
          {git.dirty ? <span className="agents-head-dirty">±{git.dirty}</span> : null}
          {git.behind ? <span className="agents-head-behind" title={t('agents.git.pull', { n: git.behind })}>⇣{git.behind}</span> : null}
          {git.ahead ? <span className="agents-head-ahead" title={t('agents.git.push', { n: git.ahead })}>⇡{git.ahead}</span> : null}
        </span>
      )}
      {s.contextPercent != null && <span className="agents-head-ctx">{Math.round(s.contextPercent)}%</span>}
      <span className="agents-head-actions">
        {running ? <HeadButton command="agents.stop" icon="square" label={t('agents.head.stop')} onClick={onStop} /> : <HeadButton command="agents.restart" icon="rotate-ccw" label={t('agents.head.restart')} onClick={onRestart} />}
        <HeadButton command="agents.copyResponse" icon="copy" label={t('agents.head.copyResponse')} onClick={onCopy} />
        <HeadButton command="agents.trajectory" icon="plan" label={t('agents.head.trajectory')} onClick={onTrajectory} />
        <HeadButton command="agents.togglePanel" icon="panel-right" label={t('agents.head.togglePanel')} onClick={onTogglePanel} />
      </span>
    </div>
  );
}
