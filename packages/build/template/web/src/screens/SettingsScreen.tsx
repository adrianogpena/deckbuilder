import { useState } from 'react';
import { AppearanceFields, ZoomField, type ApiError, detectLanguage, ErrorBanner, errorMessage, errorOf, GLOBAL, isDesktop, KeybindingsEditor, LANGUAGES, PageHead, Spinner, useAsync, useKeybindings, type Language } from '@deckbuilder/ui';
import { APP } from '../../../app';
import { api, type Settings } from '../api';
import { type MessageKey, t } from '../i18n';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

const SECTIONS = [
  { id: 'general', label: 'settings.general' },
  { id: 'layout', label: 'settings.layout' },
  { id: 'keys', label: 'settings.keys' },
  { id: 'updates', label: 'settings.updates' },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;
type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsScreen({ settings, onChange, onQuit }: Props) {
  const [section, setSection] = useState<SectionId>('general');
  return (
    <div className="content">
      <PageHead crumb={t('settings.crumb')} title={t('settings.title')} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-nav-item${section === s.id ? ' active' : ''}`} aria-current={section === s.id} onClick={() => setSection(s.id)}>
              {t(s.label)}
            </button>
          ))}
        </nav>
        <div className="scroll">
          {section === 'general' && <GeneralSection settings={settings} onChange={onChange} onQuit={onQuit} />}
          {section === 'layout' && (
            <section className="section">
              <h4 className="mono-label">{t('settings.layout')}</h4>
              <div className="card form">
                <ZoomField value={settings} onChange={onChange} />
              </div>
            </section>
          )}
          {section === 'keys' && <KeysCard settings={settings} onChange={onChange} />}
          {section === 'updates' && <UpdatesCard folder={settings.updateFolder} onFolder={(updateFolder) => onChange({ updateFolder })} />}
        </div>
      </div>
    </div>
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
    </>
  );
}

/** Every command of the app, with the keys the user can change; a change applies at once. */
function KeysCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const keys = useKeybindings();
  if (!keys) return null;
  // A view scope is a screen id; the nav labels are `nav.<screen id>`.
  const scopeLabel = (scope: string) => (scope === GLOBAL ? t('keys.global') : t(`nav.${scope}` as MessageKey));
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.keys')}</h4>
      <div className="card form keys-card">
        <KeybindingsEditor defs={keys.defs} keymap={settings.keybindings ?? {}} onChange={(keybindings) => onChange({ keybindings })} scopeLabel={scopeLabel} />
      </div>
    </section>
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
      <h4 className="mono-label">{t('settings.updates')}</h4>
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
