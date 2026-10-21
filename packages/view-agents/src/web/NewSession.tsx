import { useEffect, useRef, useState } from 'react';
import { Button, errorOf } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import { type AgentAccount, type AgentsCapWarn, CapDeclined, listAccounts, startSession } from './api';

export interface NewSessionProject {
  id: string;
  name: string;
  path: string;
}

export interface NewSessionProps {
  projects: NewSessionProject[];
  /** Preselected project. */
  projectId?: string;
  /** Account id last used in the project; used when no account is marked active, then the default account. */
  lastAccount?: (projectId: string) => string | undefined;
  /** Called with the Claude session id, the terminal session id and its socket ticket. */
  onStarted(r: { sessionId: string; terminal: string; ticket: string; account: string; projectId: string }): void;
  onCancel?(): void;
}

/** Starts a new `claude` session in the project as soon as the active account is known; shows only errors and the cap prompt. */
export function NewSession({ projects, projectId, lastAccount, onStarted, onCancel }: NewSessionProps) {
  const [accounts, setAccounts] = useState<AgentAccount[]>([]);
  const [project] = useState(projectId ?? projects[0]?.id ?? '');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<{ warn: AgentsCapWarn; answer(ok: boolean): void }>();

  useEffect(() => {
    void listAccounts().then(setAccounts, (e) => setError(errorOf(e).message));
  }, []);
  useEffect(() => {
    const preferred = lastAccount?.(project);
    const pick = accounts.find((a) => a.active) ?? accounts.find((a) => a.id === preferred) ?? accounts.find((a) => a.isDefault) ?? accounts[0];
    setAccount(pick?.id ?? '');
  }, [accounts, project, lastAccount]);

  const dir = projects.find((p) => p.id === project)?.path;
  const start = async () => {
    if (!dir || !account) return;
    const confirmCap = (warn: AgentsCapWarn) => new Promise<boolean>((answer) => setAsk({ warn, answer: (ok) => { setAsk(undefined); answer(ok); } }));
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

  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !dir || !account) return;
    auto.current = true;
    void start();
  });

  return (
    <div className="agents-new-session">
      {error && <div role="alert">{error}</div>}
      {ask && (
        <div role="alert" className="agents-cap-warn">
          {t('agents.cap.warn', { live: ask.warn.live, cap: ask.warn.cap })}
          <Button title={t('agents.new.cancel')} onClick={() => ask.answer(false)}>{t('agents.new.cancel')}</Button>
          <Button variant="primary" title={t('agents.cap.confirm')} onClick={() => ask.answer(true)}>{t('agents.cap.confirm')}</Button>
        </div>
      )}
      <div className="agents-new-session-actions">
        {onCancel && <Button title={t('agents.new.cancel')} onClick={onCancel}>{t('agents.new.cancel')}</Button>}
        {error && <Button variant="primary" icon="play" title={t('agents.new.start')} disabled={busy || !!ask || !dir || !account} onClick={() => void start()}>{t('agents.new.start')}</Button>}
      </div>
    </div>
  );
}
