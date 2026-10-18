import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentSessionView, AgentStatus } from '../protocol.ts';
import { t } from '../i18n';
import { since } from './AlertsPanel';
import { displayName } from './attention';
import { shortPath, type SessionSummary } from './session-summary';

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
  /** Digest of the loaded history; absent while it loads. */
  summary?: SessionSummary;
  /** Git branch of the session cwd, when known. */
  branch?: string | null;
}

const FILES_SHOWN = 5;

function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Chips({ s, branch }: { s: SessionSummary; branch?: string | null }) {
  const chips = [
    branch ? `⎇ ${branch}` : null,
    s.model,
    t('agents.stopped.turns', { n: s.turns }),
    s.durationMs > 0 ? duration(s.durationMs) : null,
    s.costUsd > 0 ? `$${s.costUsd.toFixed(2)}` : null,
    t('agents.stopped.filesCount', { n: s.files.length }),
  ].filter((c): c is string => !!c);
  return <div className="agents-card-chips">{chips.map((c) => <span key={c} className="agents-card-chip">{c}</span>)}</div>;
}

function Files({ files, cwd }: { files: string[]; cwd: string }) {
  const [all, setAll] = useState(false);
  if (files.length === 0) return null;
  const shown = all ? files : files.slice(0, FILES_SHOWN);
  return (
    <>
      <div className="mono-label agents-card-label">{t('agents.stopped.files')}</div>
      <ul className="agents-card-files">
        {shown.map((f) => <li key={f} title={f}>{shortPath(f, cwd)}</li>)}
      </ul>
      {files.length > FILES_SHOWN && (
        <button type="button" className="chat-more" onClick={() => setAll(!all)}>
          {all ? t('agents.stopped.showLess') : t('agents.stopped.showMore', { n: files.length - FILES_SHOWN })}
        </button>
      )}
    </>
  );
}

/** Card of a session that is not attached: name, status line, action line (Enter / s / x), then the history digest (goal, where it stopped, chips, files changed). */
export function StoppedCard({ session: s, screenError, onStart, onBackground, onRestart, onClear, summary, branch }: StoppedCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
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
      {summary === undefined ? (
        <div className="agents-card-reply">{t('agents.card.loading')}</div>
      ) : (
        <>
          <Chips s={summary} branch={branch} />
          {summary.goal && (
            <>
              <div className="mono-label agents-card-label">{t('agents.stopped.goal')}</div>
              <div className="agents-card-reply">{summary.goal}</div>
            </>
          )}
          {(summary.lastPrompt || summary.lastReply) && summary.turns > 1 && (
            <details className="agents-card-stop">
              <summary className="mono-label">{t('agents.stopped.whereStopped')}</summary>
              {summary.lastPrompt && <div className="agents-card-reply">{summary.lastPrompt}</div>}
              {summary.lastReply && <div className="agents-card-reply agents-card-last">{summary.lastReply}</div>}
            </details>
          )}
          <Files files={summary.files} cwd={s.cwd} />
        </>
      )}
    </div>
  );
}
