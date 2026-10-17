import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentSessionView, AgentStatus } from '../protocol.ts';
import { t } from '../i18n';
import { since } from './AlertsPanel';
import { lastResponse } from './api';
import { displayName } from './attention';

/** Last replies by session id, loaded once per session (null = none). */
const replies = new Map<string, string | null>();

export function cardStatus(s: AgentStatus): string {
  switch (s) {
    case 'running': return t('agents.card.status.running');
    case 'needs-you': return t('agents.card.status.needs-you');
    case 'done': return t('agents.card.status.done');
    case 'idle': return t('agents.card.status.idle');
    case 'starting': return t('agents.card.status.starting');
    case 'error': return t('agents.card.status.error');
    case 'exited': return t('agents.card.status.exited');
    default: return t('agents.card.status.stopped');
  }
}

/** The cwd with the user's home folder shown as `~`. */
export const shortCwd = (cwd: string): string => cwd.replace(/^(?:[A-Za-z]:[\\/]Users[\\/][^\\/]+|\/Users\/[^/]+|\/home\/[^/]+)(?=[\\/]|$)/, '~');

export interface StoppedCardProps {
  session: AgentSessionView;
  /** A screen error detected for the session; replaces the status text. */
  screenError?: string;
  onStart(): void;
  onBackground(): void;
  onRestart(): void;
  onClear(): void;
}

/** Card of a session that is not attached: name, status line, action line (Enter / s / x), session id and its last response. */
export function StoppedCard({ session: s, screenError, onStart, onBackground, onRestart, onClear }: StoppedCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState<string | null | undefined>(() => replies.get(s.id));
  const current = useRef(s.id);

  useEffect(() => {
    current.current = s.id;
    ref.current?.focus();
    if (replies.has(s.id)) return setReply(replies.get(s.id));
    setReply(undefined);
    const id = s.id;
    void lastResponse(id).then(
      (r) => {
        replies.set(id, r.text);
        if (current.current === id) setReply((prev) => (prev === undefined ? r.text : prev));
      },
      () => {
        if (current.current === id) setReply((prev) => (prev === undefined ? null : prev));
      },
    );
  }, [s.id]);

  const exited = s.lifecycle === 'exited' || s.status === 'exited';
  const live = s.live === true && (s.status === 'running' || s.status === 'needs-you');
  const status = screenError ?? cardStatus(s.status);
  const time = live ? t('agents.alerts.now') : t('agents.card.ago', { t: since(s.updatedAt) });
  const meta = [status + (s.external ? t('agents.card.elsewhere') : ''), s.account, time, shortCwd(s.cwd)];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.target !== e.currentTarget) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter') exited ? onRestart() : onStart();
    else if (k === 's' && !exited) onBackground();
    else if (k === 'x' && exited) onClear();
    else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className="agents-card" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="agents-card-name">{displayName(s)}</div>
      <div className={`agents-card-meta${screenError ? ' is-error' : ''}`}>{meta.join(' · ')}</div>
      <div className={`agents-card-action${exited ? ' is-exited' : ''}`}>
        {exited ? t('agents.card.exited', { code: s.exitCode == null ? '?' : String(s.exitCode) }) : t('agents.card.stopped')}
      </div>
      <div className="agents-card-id">{s.id || t('agents.card.newSession')}</div>
      <div className="mono-label agents-card-label">{t('agents.card.lastResponse')}</div>
      <div className="agents-card-reply">{reply === undefined ? t('agents.card.loading') : (reply ?? t('agents.card.noResponse'))}</div>
    </div>
  );
}
