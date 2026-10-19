import { useEffect, useRef, useState } from 'react';
import { errorOf, Modal, useDialogs, useRovingList, useToast } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import { AGENT_SHARE_DEFAULT, AGENT_SHARE_ENTRIES, type AgentAccountAdminError, type AgentShareEntry, type AgentShareReport } from '../protocol.ts';
import { type AgentAccount, addAccount, applySharedEntries, deleteAccount, listAccounts, readSharedEntries } from './api';

export type ManageAccountsMode = 'add' | 'manage';
export type AddedAccount = { folder: string; account: AgentAccount; linked: number };

export interface ManageAccountsProps {
  mode: ManageAccountsMode;
  /** An account was created (the caller makes it active and starts a session for `/login`). */
  onAdded(added: AddedAccount): void;
  /** The account list changed (delete, active choice cleared). */
  onChanged(): void;
  onClose(): void;
}

const errorText = (e: AgentAccountAdminError | string): string => (e === 'invalidName' || e === 'exists' || e === 'default' || e === 'notFound' || e === 'failed' ? t(`agents.accounts.err.${e}`) : e);

/** ', N skipped' and ', N skipped (needs developer mode)' when any. */
export const skippedSuffix = (r: Pick<AgentShareReport, 'skipped' | 'skippedDevMode'>): string =>
  (r.skipped ? t('agents.accounts.skipped', { n: String(r.skipped) }) : '') + (r.skippedDevMode ? t('agents.accounts.skippedDevMode', { n: String(r.skippedDevMode) }) : '');

function ShareChecklist({ value, onChange }: { value: ReadonlySet<AgentShareEntry>; onChange(next: Set<AgentShareEntry>): void }) {
  const toggle = (e: AgentShareEntry) => {
    const next = new Set(value);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    onChange(next);
  };
  return (
    <ul className="agents-acct-share">
      {AGENT_SHARE_ENTRIES.map((e) => (
        <li key={e}>
          <label>
            <input type="checkbox" checked={value.has(e)} onChange={() => toggle(e)} />
            {t(`agents.accounts.share.${e}`)}
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Add account form, Manage accounts list, Edit shared entries and Delete account (confirmed). */
export function ManageAccounts({ mode, onAdded, onChanged, onClose }: ManageAccountsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const dialogs = useDialogs();
  const [view, setView] = useState<{ kind: 'add' } | { kind: 'list' } | { kind: 'edit'; folder: string }>(mode === 'add' ? { kind: 'add' } : { kind: 'list' });
  const [accounts, setAccounts] = useState<AgentAccount[]>();
  const [name, setName] = useState('');
  const [share, setShare] = useState<Set<AgentShareEntry>>(new Set(AGENT_SHARE_DEFAULT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useRovingList(ref, '.agents-acct-row button');
  const load = () => void listAccounts().then(setAccounts, (e) => setError(errorOf(e).message));
  useEffect(load, []);

  const run = async <R extends { ok: boolean; error?: string }>(call: () => Promise<R>): Promise<R | undefined> => {
    setError('');
    setBusy(true);
    try {
      const r = await call();
      if (!r.ok) setError(errorText(r.error ?? 'failed'));
      return r.ok ? r : undefined;
    } catch (e) {
      setError(errorOf(e).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const r = await run(() => addAccount(name, [...share]));
    if (r?.ok) {
      onAdded({ folder: r.folder, account: r.account, linked: r.linked });
      onClose();
    }
  };
  const openEdit = async (folder: string) => {
    const r = await run(() => readSharedEntries(folder));
    if (r?.ok) {
      setShare(new Set(r.shared));
      setView({ kind: 'edit', folder });
    }
  };
  const apply = async (folder: string) => {
    const r = await run(() => applySharedEntries(folder, [...share]));
    if (!r?.ok) return;
    toast({ message: t('agents.accounts.applied', { folder, linked: String(r.linked), unlinked: String(r.unlinked) }) + skippedSuffix(r) });
    setView({ kind: 'list' });
  };
  const remove = async (folder: string) => {
    const ok = await dialogs.confirm({ title: t('agents.accounts.deleteOk'), body: t('agents.accounts.deleteConfirm', { folder }), okLabel: t('agents.accounts.deleteOk'), danger: true });
    if (!ok) return;
    const r = await run(() => deleteAccount(folder));
    if (!r?.ok) return;
    toast({ message: t(r.wasActive ? 'agents.accounts.deletedActive' : 'agents.accounts.deleted', { folder }) });
    onChanged();
    load();
  };

  if (view.kind === 'add') {
    return (
      <Modal
        title={t('agents.accounts.addTitle')}
        onClose={onClose}
        footer={<button type="button" className="btn btn-primary" title={t('agents.accounts.create')} disabled={busy || !name.trim()} onClick={() => void create()}>{t('agents.accounts.create')}</button>}
      >
        <form className="agents-acct-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
          <label className="agents-acct-field">
            <span>{t('agents.accounts.name')}</span>
            <input className="agents-acct-input" autoFocus value={name} placeholder={t('agents.accounts.namePlaceholder')} spellCheck={false} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="agents-acct-label">{t('agents.accounts.share')}</div>
          <ShareChecklist value={share} onChange={setShare} />
          {error && <div role="alert" className="agents-acct-error">{error}</div>}
        </form>
      </Modal>
    );
  }

  if (view.kind === 'edit') {
    return (
      <Modal
        title={t('agents.accounts.editTitle', { folder: view.folder })}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" title={t('agents.accounts.back')} onClick={() => { setError(''); setView({ kind: 'list' }); }}>{t('agents.accounts.back')}</button>
            <button type="button" className="btn btn-primary" title={t('agents.accounts.apply')} disabled={busy} onClick={() => void apply(view.folder)}>{t('agents.accounts.apply')}</button>
          </>
        }
      >
        <div className="agents-acct-form">
          <div className="agents-acct-hint">{t('agents.accounts.editHint')}</div>
          <ShareChecklist value={share} onChange={setShare} />
          {error && <div role="alert" className="agents-acct-error">{error}</div>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('agents.accounts.manageTitle')} onClose={onClose}>
      <div className="agents-acct-list" ref={ref} role="group" aria-label={t('agents.accounts.manageTitle')}>
        {!accounts && !error && <div className="agents-pick-note">{t('agents.account.loading')}</div>}
        {accounts?.map((a) => (
          <div key={a.dir} className="agents-acct-row" title={a.dir}>
            <span className="agents-acct-name">
              <span className="agents-acct-folder">{a.id}</span>
              {' · '}
              <span className={a.email ? 'agents-acct-email' : 'agents-acct-email muted'}>{a.email ?? t('agents.accounts.notLoggedIn')}</span>
            </span>
            {a.isDefault ? (
              <span className="agents-acct-note">{t('agents.accounts.defaultNote')}</span>
            ) : (
              <span className="agents-acct-actions">
                <button type="button" className="btn btn-sm" title={t('agents.accounts.edit')} disabled={busy} onClick={() => void openEdit(a.id)}>{t('agents.accounts.edit')}</button>
                <button type="button" className="btn btn-sm btn-danger" title={t('agents.accounts.delete')} disabled={busy} onClick={() => void remove(a.id)}>{t('agents.accounts.delete')}</button>
              </span>
            )}
          </div>
        ))}
        {error && <div role="alert" className="agents-acct-error">{error}</div>}
      </div>
    </Modal>
  );
}
