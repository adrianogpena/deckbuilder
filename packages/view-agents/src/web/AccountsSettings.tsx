import { useCallback, useEffect, useRef, useState } from 'react';
import { errorOf, SettingItem, useDialogs, useToast } from '@deckbuilderkit/ui';
import { t, type AgentsMessageKey } from '../i18n';
import { ACCOUNT_STATUS_ICONS, ACCOUNT_STATUS_KEYS, ACCOUNT_USAGE_BOOL_KEYS, type AccountPrefs, type AccountStatusKey, type AccountUsagePrefs } from '../protocol.ts';
import { statusIconFor, withAccountPrefs, defaultStatusIcon } from './account-prefs';
import { type AgentAccount, deleteAccount, listAccounts } from './api';
import { confirmDeleteAccount, deletedMessage, ManageAccounts } from './ManageAccounts';
import { StatusIcon } from './StatusIcon';
import { useAccountPrefs } from './useAccountPrefs';

const msg = (key: string, params?: Record<string, string>) => t(key as AgentsMessageKey, params);

type UsageKey = keyof AccountUsagePrefs;
const USAGE_KEYS: UsageKey[] = [...ACCOUNT_USAGE_BOOL_KEYS.slice(0, 1), 'position', ...ACCOUNT_USAGE_BOOL_KEYS.slice(1)];

/** Global / On / Off (or Global / Top / Bottom for the position) as chips; Global = no override. */
function OverrideRow({ usageKey, value, onChange }: { usageKey: UsageKey; value: boolean | 'top' | 'bottom' | undefined; onChange(v: boolean | 'top' | 'bottom' | undefined): void }) {
  const options: { v: boolean | 'top' | 'bottom' | undefined; label: string }[] =
    usageKey === 'position'
      ? [{ v: undefined, label: t('settings.agents.accounts.inherit') }, { v: 'top', label: msg('settings.agents.usage.position.top') }, { v: 'bottom', label: msg('settings.agents.usage.position.bottom') }]
      : [{ v: undefined, label: t('settings.agents.accounts.inherit') }, { v: true, label: t('settings.agents.accounts.on') }, { v: false, label: t('settings.agents.accounts.off') }];
  return (
    <div className="field">
      <span className="mono-label">{msg(`settings.agents.usage.${usageKey}`)}</span>
      <div className="chips" role="group" aria-label={msg(`settings.agents.usage.${usageKey}`)}>
        {options.map((o) => (
          <button type="button" key={String(o.v)} title={o.label} aria-pressed={value === o.v} className={`chip${value === o.v ? ' chip-on' : ''}`} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A status icon that opens a small popover with the curated shapes of that status; the default is first and marked. */
function IconPicker({ status, value, onPick }: { status: AccountStatusKey; value: string; onPick(id: string): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const statusLabel = msg(`settings.agents.accounts.icon.${status}`);
  const nameOf = (id: string) => msg(`settings.agents.accounts.icon.id.${id}`);
  return (
    <span className="agents-icon-picker" ref={ref}>
      <button type="button" className="agents-icon-btn" aria-haspopup="listbox" aria-expanded={open} title={t('settings.agents.accounts.icon.choose', { status: statusLabel })} onClick={() => setOpen((o) => !o)}>
        <StatusIcon status={status} icon={value} />
        <span>{nameOf(value)}</span>
      </button>
      {open && (
        <div className="agents-icon-pop" role="listbox" aria-label={t('settings.agents.accounts.icon.choose', { status: statusLabel })}>
          {ACCOUNT_STATUS_ICONS[status].map((id) => {
            const isDefault = id === defaultStatusIcon(status);
            const title = isDefault ? `${nameOf(id)} (${t('settings.agents.accounts.icon.default')})` : nameOf(id);
            return (
              <button type="button" key={id} role="option" aria-selected={id === value} className={`agents-icon-opt${id === value ? ' agents-icon-opt--on' : ''}`} title={title} onClick={() => { onPick(id); setOpen(false); }}>
                <StatusIcon status={status} icon={id} />
                {isDefault && <span className="agents-icon-default" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function AccountPage({ account, prefs, onSave }: { account: AgentAccount; prefs: AccountPrefs; onSave(next: AccountPrefs): void }) {
  const usage = prefs.usage ?? {};
  const setUsage = (k: UsageKey, v: boolean | 'top' | 'bottom' | undefined) => {
    const next: Record<string, unknown> = { ...usage };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onSave({ ...prefs, usage: next as AccountUsagePrefs });
  };
  const setIcon = (status: AccountStatusKey, id: string) => {
    const next = { ...prefs.icons };
    if (id === defaultStatusIcon(status)) delete next[status];
    else next[status] = id;
    onSave({ ...prefs, icons: next });
  };
  return (
    <div className="agents-acct-body" data-account={account.id}>
      <div className="field">
        <span className="mono-label">{t('settings.agents.accounts.icons')}</span>
        <span className="muted">{t('settings.agents.accounts.icons.hint')}</span>
      </div>
      {ACCOUNT_STATUS_KEYS.map((status) => {
        const current = statusIconFor({ [account.id]: prefs }, account.id, status);
        return (
          <SettingItem key={status} id={`agents.accounts.${account.id}.icon.${status}`} modified={prefs.icons?.[status] !== undefined}>
            <div className="field agents-acct-icon-row">
              <span className="mono-label">{msg(`settings.agents.accounts.icon.${status}`)}</span>
              <IconPicker status={status} value={current} onPick={(id) => setIcon(status, id)} />
            </div>
          </SettingItem>
        );
      })}
      <div className="field">
        <span className="mono-label">{t('settings.agents.accounts.usage')}</span>
        <span className="muted">{t('settings.agents.accounts.usage.hint')}</span>
      </div>
      {USAGE_KEYS.map((k) => (
        <SettingItem key={k} id={`agents.accounts.${account.id}.usage.${k}`} modified={usage[k] !== undefined}>
          <OverrideRow usageKey={k} value={usage[k]} onChange={(v) => setUsage(k, v)} />
        </SettingItem>
      ))}
    </div>
  );
}

/** Settings > Agents > Accounts: a picker chooses one Claude account (default: the active one); its status icons and usage overrides show below, with Add and Remove through the Manage accounts flow. */
export function AccountsSettings({ activeAccount = '' }: { activeAccount?: string }) {
  const { prefs, save } = useAccountPrefs();
  const toast = useToast();
  const dialogs = useDialogs();
  const [accounts, setAccounts] = useState<AgentAccount[]>();
  const [picked, setPicked] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => void listAccounts().then(setAccounts, (e) => setError(errorOf(e).message)), []);
  useEffect(load, [load]);

  const current = accounts?.find((a) => a.id === picked) ?? accounts?.find((a) => (activeAccount ? a.id === activeAccount : a.isDefault)) ?? accounts?.[0];

  const saveFor = async (id: string, next: AccountPrefs) => {
    setError('');
    try {
      if (!(await save(withAccountPrefs(prefs, id, next)))) setError(t('settings.agents.accounts.saveFailed'));
    } catch (e) {
      setError(errorOf(e).message);
    }
  };
  const remove = async (folder: string) => {
    if (!(await confirmDeleteAccount(dialogs, folder))) return;
    setBusy(true);
    setError('');
    try {
      const r = await deleteAccount(folder);
      if (r.ok) {
        toast({ message: deletedMessage(r) });
        setPicked('');
        load();
      } else {
        setError(t(`agents.accounts.err.${r.error}`));
      }
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  const label = (a: AgentAccount) => `${a.id} - ${a.email ?? t('agents.accounts.notLoggedIn')}${a.isDefault ? ` (${t('agents.accounts.defaultNote')})` : ''}`;

  return (
    <section className="section">
      <div className="card form">
        <div className="field agents-acct-picker">
          <span className="mono-label">{t('settings.agents.accounts')}</span>
          {current && (
            <select aria-label={t('settings.agents.accounts.pick')} value={current.id} onChange={(e) => setPicked(e.target.value)}>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
            </select>
          )}
          <button type="button" className="agents-statusline-btn" title={t('settings.agents.accounts.add')} onClick={() => setAdding(true)}>{t('settings.agents.accounts.add')}</button>
          {current && !current.isDefault && (
            <button type="button" className="agents-statusline-btn" disabled={busy} title={t('settings.agents.accounts.remove')} onClick={() => void remove(current.id)}>{t('settings.agents.accounts.remove')}</button>
          )}
        </div>
        <span className="muted">{t('settings.agents.accounts.hint')}</span>
        {accounts?.length === 0 && <span className="muted">{t('settings.agents.accounts.none')}</span>}
        {current && <AccountPage key={current.id} account={current} prefs={prefs[current.id] ?? {}} onSave={(next) => void saveFor(current.id, next)} />}
        {error && <span className="agents-statusline-error" role="alert">{error}</span>}
      </div>
      {adding && <ManageAccounts mode="add" onAdded={load} onChanged={load} onClose={() => setAdding(false)} />}
    </section>
  );
}
