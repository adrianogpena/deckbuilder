import { useMemo, useState } from 'react';
import { Button, ErrorBanner, SettingItem, Spinner, useAsync, type SettingsCardProps } from '@deckbuilderkit/ui';
import { agentsSettingDefs, type AgentsViewSettings } from '../settings';
import { t, type AgentsMessageKey } from '../i18n';
import { AccountsSettings } from './AccountsSettings';
import { UsageView, usageSample, usageSettingsOf } from './UsageView';
import { installStatusline, listStatusline, uninstallStatusline, type AgentStatuslineStatus } from './api';

const IDS = agentsSettingDefs.map((d) => d.id);
const USAGE_IDS = IDS.filter((id) => id.startsWith('agents.usage.'));
const ACCOUNT_IDS = IDS.filter((id) => id.startsWith('agents.accounts.'));
const OTHER_IDS = IDS.filter((id) => !id.startsWith('agents.usage.') && !id.startsWith('agents.accounts.'));

/** The Agents > Accounts settings page. */
export function AgentsAccountsCard({ settings, rows }: SettingsCardProps<AgentsViewSettings>) {
  return (
    <>
      {rows(ACCOUNT_IDS)}
      <AccountsSettings activeAccount={settings.agents?.['accounts.activeAccount'] ?? ''} />
    </>
  );
}

/** The Agents page: the schema rows of the view itself. */
export function AgentsSettingsCard({ rows }: SettingsCardProps<AgentsViewSettings>) {
  return <>{rows(OTHER_IDS)}</>;
}

/** The Agents > Usage page: the status line rows with their preview, then the status line install per account. */
export function AgentsUsageCard({ settings, rows }: SettingsCardProps<AgentsViewSettings>) {
  const usage = usageSettingsOf(settings.agents);
  const now = useMemo(() => Date.now(), []);
  const sample = useMemo(() => usageSample(now), [now]);
  return (
    <>
      <div className="settings-format">
        <aside className="settings-format-preview">
          <h4 className="mono-label">{t('settings.agents.usage.preview')}</h4>
          <span className="muted">{t('settings.agents.usage.preview.hint')}</span>
          <UsageView {...sample} items={usage.items} compact={usage.compact} use24h={usage.use24h} now={now} />
        </aside>
        <div className="settings-format-options">{rows(USAGE_IDS)}</div>
      </div>
      <StatuslineSection />
    </>
  );
}

function StatuslineSection() {
  const list = useAsync(listStatusline, []);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState<string>();
  const [done, setDone] = useState<Record<string, AgentStatuslineStatus>>({});

  const run = async (s: AgentStatuslineStatus) => {
    setBusy(s.account);
    try {
      const r = await (s.installed ? uninstallStatusline : installStatusline)(s.account);
      if (r.ok) {
        setDone((d) => ({ ...d, [s.account]: r.status }));
        setErrors((e) => ({ ...e, [s.account]: undefined }));
      } else {
        setErrors((e) => ({ ...e, [s.account]: t(`settings.agents.statusline.error.${r.error}` as AgentsMessageKey) }));
      }
    } catch (err) {
      setErrors((e) => ({ ...e, [s.account]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(undefined);
    }
  };

  const accounts = (list.data ?? []).map((s) => done[s.account] ?? s);
  return (
    <section className="section">
      <div className="card form">
        <div className="field">
          <span className="mono-label">{t('settings.agents.statusline')}</span>
          <span className="muted">{t('settings.agents.statusline.hint')}</span>
        </div>
        {list.error && <ErrorBanner error={list.error} onRetry={list.reload} compact />}
        {list.loading && !list.data && <Spinner />}
        {list.data && accounts.length === 0 && <span className="muted">{t('settings.agents.statusline.none')}</span>}
        {accounts.map((s) => {
          const blocked = !s.installed && !s.settingsOk;
          const error = errors[s.account];
          return (
            <SettingItem key={s.account} id={`agents.statusline.${s.account}`} modified={false}>
              <div className="field agents-statusline">
                <span className="mono-label">{s.label}</span>
                <Button
                  size="sm"
                  variant={s.installed ? 'danger' : 'default'}
                  icon={s.installed ? 'trash' : 'download'}
                  className="agents-statusline-btn"
                  title={t(s.installed ? 'settings.agents.statusline.uninstall' : 'settings.agents.statusline.install')}
                  disabled={busy !== undefined || blocked}
                  onClick={() => void run(s)}
                >
                  {t(s.installed ? 'settings.agents.statusline.uninstall' : 'settings.agents.statusline.install')}
                </Button>
                {s.previous && <span className="muted">{t('settings.agents.statusline.previous', { command: s.previous })}</span>}
                {blocked && <span className="muted">{t('settings.agents.statusline.invalid')}</span>}
                {error && <span className="agents-statusline-error" role="alert">{error}</span>}
              </div>
            </SettingItem>
          );
        })}
      </div>
    </section>
  );
}
