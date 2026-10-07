import { useEffect, useState } from 'react';
import { type ApiError, detectLanguage, ErrorBanner, errorOf, LANGUAGES, PageHead, Spinner, useAsync, type Language } from '@deckbase/ui';
import { api, type Settings } from '../api';
import { t } from '../i18n';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

export function SettingsScreen({ settings, onChange }: Props) {
  return (
    <div className="content">
      <PageHead crumb={t('settings.crumb')} title={t('settings.title')} />
      <div className="scroll">
        <div className="card form">
          <div className="field">
            <span className="mono-label">{t('settings.theme')}</span>
            <div className="chips">
              {(['dark', 'light'] as const).map((theme) => (
                <button key={theme} className={`chip${settings.theme === theme ? ' chip-on' : ''}`} onClick={() => onChange({ theme })}>
                  {t(`settings.theme.${theme}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="mono-label">{t('settings.language')}</span>
            <select value={settings.language ?? detectLanguage()} onChange={(e) => onChange({ language: e.target.value as Language })}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <div className="field">
            <span className="mono-label">{t('settings.autostart')}</span>
            <div className="chips">
              {([true, false] as const).map((on) => (
                <button key={String(on)} className={`chip${settings.autostart === on ? ' chip-on' : ''}`} onClick={() => onChange({ autostart: on })}>
                  {t(on ? 'settings.autostart.on' : 'settings.autostart.off')}
                </button>
              ))}
            </div>
            <span className="muted">{t('settings.autostart.hint')}</span>
          </div>
        </div>
        <UpdatesCard folder={settings.updateFolder} onFolder={(updateFolder) => onChange({ updateFolder })} />
      </div>
    </div>
  );
}

function UpdatesCard({ folder, onFolder }: { folder: string; onFolder: (folder: string) => void }) {
  const [draft, setDraft] = useState(folder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const state = useAsync(() => api.update(), [folder], 60_000);

  useEffect(() => setDraft(folder), [folder]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const u = state.data;
  const status = !u
    ? null
    : u.status === 'not-configured'
      ? t('settings.update.notConfigured')
      : u.available
        ? t('settings.update.available', { version: u.version ?? '' })
        : u.status === 'offline'
          ? t('settings.update.offline')
          : u.status === 'error'
            ? (u.message ?? '')
            : t('settings.update.latest');

  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.updates')}</h4>
      <div className="card form">
        <label className="field">
          <span className="mono-label">{t('settings.updateFolder')}</span>
          <input
            value={draft}
            placeholder="\\server\share\releases"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft.trim() !== folder && onFolder(draft.trim())}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span className="muted">{t('settings.updateFolder.hint')}</span>
        </label>
        {!u && !state.error && <Spinner small />}
        {state.error && <ErrorBanner error={state.error} onRetry={state.reload} compact />}
        {u && (
          <div className="field">
            <span>
              {t('settings.update.current', { version: u.current })} {status}
            </span>
            {u.available && u.notes && <pre className="mono muted">{u.notes}</pre>}
            {u.available && !u.canApply && <span className="muted">{t('settings.update.fromSource')}</span>}
            <div className="row">
              <button className="btn btn-sm" disabled={busy || !folder} onClick={() => run(() => api.checkUpdate().then(() => state.reload()))}>
                {t('settings.update.check')}
              </button>
              {u.available && u.canApply && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy || restarting !== null}
                  onClick={() => run(async () => setRestarting((await api.applyUpdate()).version))}
                >
                  {t('settings.update.apply')}
                </button>
              )}
            </div>
          </div>
        )}
        {restarting && <span className="muted">{t('settings.update.restarting', { version: restarting })}</span>}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}
