import { useEffect, useState } from 'react';
import { AppearanceFields, type ApiError, detectLanguage, ErrorBanner, errorOf, isDesktop, LANGUAGES, PageHead, Spinner, useAsync, type Language } from '@deckbuilder/ui';
import { APP } from '../../../app';
import { api, type Settings } from '../api';
import { t } from '../i18n';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

export function SettingsScreen({ settings, onChange, onQuit }: Props) {
  return (
    <div className="content">
      <PageHead crumb={t('settings.crumb')} title={t('settings.title')} />
      <div className="scroll">
        <section className="section">
          <h4 className="mono-label">{t('settings.theme')}</h4>
          <div className="card form">
            <AppearanceFields value={settings} onChange={onChange} />
          </div>
        </section>
        <div className="card form">
          <label className="field">
            <span className="mono-label">{t('settings.language')}</span>
            <select value={settings.language ?? detectLanguage()} onChange={(e) => onChange({ language: e.target.value as Language })}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <OnOffField
            label={t('settings.autostart')}
            hint={t('settings.autostart.hint')}
            value={settings.autostart}
            onChange={(autostart) => onChange({ autostart })}
          />
          <OnOffField
            label={t('settings.closeToTray')}
            hint={t('settings.closeToTray.hint')}
            value={settings.closeToTray}
            onChange={(closeToTray) => onChange({ closeToTray })}
          />
        </div>
        {(!isDesktop || settings.closeToTray) && <GeneralCard onQuit={onQuit} />}
        <UpdatesCard folder={settings.updateFolder} onFolder={(updateFolder) => onChange({ updateFolder })} />
      </div>
    </div>
  );
}

function OnOffField({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="field">
      <span className="mono-label">{label}</span>
      <div className="chips">
        {([true, false] as const).map((on) => (
          <button key={String(on)} className={`chip${value === on ? ' chip-on' : ''}`} onClick={() => onChange(on)}>
            {t(on ? 'settings.on' : 'settings.off')}
          </button>
        ))}
      </div>
      <span className="muted">{hint}</span>
    </div>
  );
}

/**
 * Where closing the window doesn't stop the app: browser and app mode, and with the tray (the
 * setting, which applies after a restart; until then the tray menu or the close button quits).
 */
function GeneralCard({ onQuit }: { onQuit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const quit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.quit();
      onQuit();
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.general')}</h4>
      <div className="card form">
        <div className="field">
          <div className="row">
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={quit}>
              {t('settings.quit')}
            </button>
          </div>
          <span className="muted">{t(isDesktop ? 'settings.quit.hintTray' : 'settings.quit.hint', { name: APP.name })}</span>
        </div>
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
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
            {u.source && <span className="muted">{t('settings.update.source', { source: sourceLabel(u.source) })}</span>}
            {u.available && u.notes && <pre className="mono muted">{u.notes}</pre>}
            {u.available && !u.canApply && <span className="muted">{t('settings.update.fromSource')}</span>}
            <div className="row">
              <button className="btn btn-sm" disabled={busy || !u.source} onClick={() => run(() => api.checkUpdate().then(() => state.reload()))}>
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

const sourceLabel = (id: string): string => (id.startsWith('github:') ? `GitHub ${id.slice(7)}` : `${t('settings.update.folder')} ${id.slice(7)}`);
