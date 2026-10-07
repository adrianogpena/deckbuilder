import { detectLanguage, LANGUAGES, PageHead, type Language } from '@deckbase/ui';
import type { Settings } from '../api';
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
        </div>
      </div>
    </div>
  );
}
