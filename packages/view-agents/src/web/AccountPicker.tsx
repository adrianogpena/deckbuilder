import { useEffect, useRef, useState } from 'react';
import { errorOf, Modal, useRovingList, useToast } from '@kedalion/ui';
import { t } from '../i18n';
import { type AgentAccount, listAccounts, setActiveAccount } from './api';

export interface AccountPickerProps {
  /** The active account changed (the reply's account, `active` set). */
  onSwitched?(account: AgentAccount): void;
  /** '+ Add account…' (placeholder until the add flow exists). */
  onAdd?(): void;
  /** '≡ Manage accounts…' (placeholder until the manage panel exists). */
  onManage?(): void;
  onClose(): void;
}

/** The `dir` `POST /api/agents/accounts/active` takes: "" for the default account. */
export const activeDirOf = (a: AgentAccount): string => (a.isDefault ? '' : a.dir);

/** Switch account picker: each account (active one marked `*`), then + Add account… and ≡ Manage accounts…. Opening it rediscovers the accounts. */
export function AccountPicker({ onSwitched, onAdd, onManage, onClose }: AccountPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [accounts, setAccounts] = useState<AgentAccount[]>();
  const [error, setError] = useState('');
  useRovingList(ref, '.agents-pick');
  useEffect(() => {
    void listAccounts().then(setAccounts, (e) => setError(errorOf(e).message));
  }, []);

  const pick = async (a: AgentAccount) => {
    setError('');
    const r = await setActiveAccount(activeDirOf(a)).catch((e) => ({ ok: false as const, error: errorOf(e).message }));
    if (!r.ok) return void setError(r.error === 'unknownAccount' ? t('agents.account.unknown') : r.error);
    toast({ message: t('agents.account.flash', { label: r.label }) });
    onSwitched?.(r.account);
    onClose();
  };
  const extra = (key: string, label: string, run?: () => void) => (
    <button key={key} type="button" className="agents-pick" title={label} onClick={() => { onClose(); run?.(); }}>
      <span className="agents-pick-mark" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <Modal title={t('agents.account.title')} onClose={onClose}>
      <div className="agents-pick-list" ref={ref} role="group" aria-label={t('agents.account.title')}>
        {!accounts && !error && <div className="agents-pick-note">{t('agents.account.loading')}</div>}
        {accounts?.map((a) => (
          <button key={a.dir} type="button" className={`agents-pick${a.active ? ' current' : ''}`} title={a.dir} autoFocus={a.active} aria-current={a.active ? 'true' : undefined} onClick={() => void pick(a)}>
            <span className="agents-pick-mark" aria-hidden="true">{a.active ? '*' : ''}</span>
            {a.label}
          </button>
        ))}
        {accounts && extra('add', t('agents.account.add'), onAdd)}
        {accounts && extra('manage', t('agents.account.manage'), onManage)}
        {error && <div role="alert" className="agents-pick-note">{error}</div>}
      </div>
    </Modal>
  );
}
