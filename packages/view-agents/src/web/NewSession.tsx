import { useEffect, useState } from 'react';
import { errorOf } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import { type AgentAccount, type AgentsCapWarn, CapDeclined, capWarning, listAccounts, startSession } from './api';

export interface NewSessionProject {
  id: string;
  name: string;
  path: string;
}

export interface NewSessionProps {
  projects: NewSessionProject[];
  /** Preselected project. */
  projectId?: string;
  /** Account id last used in the project; the default account is used when absent. */
  lastAccount?: (projectId: string) => string | undefined;
  /** Called with the Claude session id, the terminal session id and its socket ticket. */
  onStarted(r: { sessionId: string; terminal: string; ticket: string; account: string; projectId: string }): void;
  /** Mode for the new session; `chat` calls `onChat` instead of starting a terminal. */
  mode?: 'terminal' | 'chat';
  onChat?(r: { account: string; projectId: string; cwd: string }): void;
  onCancel?(): void;
}

/** Picks project and account, then starts a new `claude` session in a terminal. */
export function NewSession({ projects, projectId, lastAccount, mode, onChat, onStarted, onCancel }: NewSessionProps) {
  const [accounts, setAccounts] = useState<AgentAccount[]>([]);
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? '');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<{ warn: AgentsCapWarn; answer(ok: boolean): void }>();

  useEffect(() => {
    void listAccounts().then(setAccounts, (e) => setError(errorOf(e).message));
  }, []);
  useEffect(() => {
    const preferred = lastAccount?.(project);
    const pick = accounts.find((a) => a.id === preferred) ?? accounts.find((a) => a.isDefault) ?? accounts[0];
    setAccount(pick?.id ?? '');
  }, [accounts, project, lastAccount]);

  const dir = projects.find((p) => p.id === project)?.path;
  const start = async () => {
    if (!dir || !account) return;
    const confirmCap = (warn: AgentsCapWarn) => new Promise<boolean>((answer) => setAsk({ warn, answer: (ok) => { setAsk(undefined); answer(ok); } }));
    if (mode === 'chat' && onChat) {
      const warn = await capWarning().catch(() => undefined);
      if (warn && !(await confirmCap(warn))) return;
      return onChat({ account, projectId: project, cwd: dir });
    }
    setBusy(true);
    setError('');
    try {
      const r = await startSession({ account, dir, confirmCap });
      onStarted({ sessionId: r.sessionId, terminal: r.session, ticket: r.ticket, account, projectId: project });
    } catch (e) {
      if (!(e instanceof CapDeclined)) setError(errorOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agents-new-session">
      <label>
        {t('agents.new.project')}
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        {t('agents.new.account')}
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.email ? `${a.label} (${a.email})` : a.label}</option>
          ))}
        </select>
      </label>
      {error && <div role="alert">{error}</div>}
      {ask && (
        <div role="alert" className="agents-cap-warn">
          {t('agents.cap.warn', { live: ask.warn.live, cap: ask.warn.cap })}
          <button type="button" onClick={() => ask.answer(false)}>{t('agents.new.cancel')}</button>
          <button type="button" onClick={() => ask.answer(true)}>{t('agents.cap.confirm')}</button>
        </div>
      )}
      <div className="agents-new-session-actions">
        {onCancel && <button type="button" onClick={onCancel}>{t('agents.new.cancel')}</button>}
        <button type="button" disabled={busy || !!ask || !dir || !account} onClick={() => void start()}>{t('agents.new.start')}</button>
      </div>
    </div>
  );
}
