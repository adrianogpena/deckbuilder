import { useState } from 'react';
import { AppearanceFields, ZoomField, type ApiError, detectLanguage, ErrorBanner, errorMessage, errorOf, Icon, isDesktop, LANGUAGES, Modal, SettingRow, Spinner, useAsync, type Language } from '@deckbuilder/ui';
import { APP } from '../../../app';
import { api, type Settings } from '../api';
import { type MessageKey, t } from '../i18n';
import { settingsRegistry } from '../settings';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

const SECTIONS = [
  { id: 'general', label: 'settings.general' },
  { id: 'layout', label: 'settings.layout' },
  { id: 'updates', label: 'settings.updates' },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;
type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * Settings as VS Code opens them: a modal editor over the current screen, closed with Escape or a click outside.
 * The keybindings have a screen of their own (`KeysScreen`), linked from the section list.
 */
export function SettingsModal({ settings, onChange, onQuit, onClose, onOpenKeys }: Props & { onClose: () => void; onOpenKeys: () => void }) {
  const [section, setSection] = useState<SectionId>('general');
  return (
    <Modal title={t('settings.title')} onClose={onClose} large>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-nav-item${section === s.id ? ' active' : ''}`} aria-current={section === s.id} onClick={() => setSection(s.id)}>
              {t(s.label)}
            </button>
          ))}
          <div className="settings-nav-sep" />
          <button className="settings-nav-item settings-nav-link" onClick={onOpenKeys}>
            <Icon name="key" />
            {t('settings.keys')}
          </button>
        </nav>
        <div className="scroll">
          <h3 className="settings-group-title">{t(SECTIONS.find((s) => s.id === section)!.label)}</h3>
          {section === 'general' && <GeneralSection settings={settings} onChange={onChange} onQuit={onQuit} />}
          {section === 'layout' && (
            <section className="section">
              <div className="card form">
                <ZoomField value={settings} onChange={onChange} />
              </div>
            </section>
          )}
          {section === 'updates' && <UpdatesCard folder={settings.updateFolder} onFolder={(updateFolder) => onChange({ updateFolder })} />}
        </div>
      </div>
    </Modal>
  );
}

function GeneralSection({ settings, onChange, onQuit }: Props) {
  return (
    <>
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
        {settingsRegistry.settingsIn(['general']).map((def) => <SettingRow key={def.id} def={def} settings={settings} onChange={onChange} />)}
      </div>
      {(!isDesktop || settings.closeToTray) && <GeneralCard onQuit={onQuit} />}
    </>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const state = useAsync(() => api.update(), [folder], 60_000);

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
    : u.code
      ? errorMessage({ kind: 'internal', code: u.code, message: u.message ?? '' })
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
      <div className="card form">
        <div className="field">
          <label className="mono-label" htmlFor="update-folder">{t('settings.updateFolder')}</label>
          <div className="row">
            <input id="update-folder" value={folder} placeholder={t('settings.updateFolder.none')} readOnly />
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => run(async () => {
                const next = (await api.pickUpdateFolder(t('settings.updateFolder.pick'))).updateFolder;
                if (next !== folder) onFolder(next);
              })}
            >
              {t('settings.updateFolder.browse')}
            </button>
            {folder && (
              <button className="btn btn-sm" disabled={busy} onClick={() => onFolder('')}>
                {t('settings.updateFolder.clear')}
              </button>
            )}
          </div>
          <span className="muted">{t('settings.updateFolder.hint')}</span>
        </div>
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
