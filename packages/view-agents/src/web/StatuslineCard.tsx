import { useState } from 'react';
import { ErrorBanner, SettingItem, Spinner, useAsync, type SettingsCardProps } from '@deckbuilderkit/ui';
import { agentsSettingDefs, type AgentsViewSettings } from '../settings';
import { t, type AgentsMessageKey } from '../i18n';
import { installStatusline, listStatusline, uninstallStatusline, type AgentStatuslineStatus } from './api';

const IDS = agentsSettingDefs.map((d) => d.id);

/** The Agents settings page: the schema rows, then the usage status line install per account. */
export function AgentsSettingsCard({ rows }: SettingsCardProps<AgentsViewSettings>) {
  return (
    <>
      {rows(IDS)}
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
                <button
                  type="button"
                  className="agents-statusline-btn"
                  disabled={busy !== undefined || blocked}
                  onClick={() => void run(s)}
                >
                  {t(s.installed ? 'settings.agents.statusline.uninstall' : 'settings.agents.statusline.install')}
                </button>
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
