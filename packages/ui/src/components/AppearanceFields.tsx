import { effectiveKind, familySibling, PALETTES, resolvePalette, type ThemeKind, type ThemePreference, type ThemeSettings } from '@deckbuilder/server-core/palettes';
import { t } from '../i18n';
import { useSystemKind } from '../theme';

interface Props {
  value: ThemeSettings;
  onChange: (patch: Partial<ThemeSettings>) => void;
}

const PREFERENCES: ThemePreference[] = ['system', 'dark', 'light'];

/** Theme chips (System/Dark/Light) and one palette select for the side in use; a pick keeps the other side in the same family. */
export function AppearanceFields({ value, onChange }: Props) {
  const kind = effectiveKind(value.theme, useSystemKind());
  const current = kind === 'dark'
    ? resolvePalette('dark', value.paletteDark, value.paletteLight)
    : resolvePalette('light', value.paletteLight, value.paletteDark);

  const pick = (kind: ThemeKind, id: string) => {
    const otherKind = kind === 'dark' ? 'light' : 'dark';
    const sibling = familySibling(id, otherKind);
    const own = kind === 'dark' ? 'paletteDark' : 'paletteLight';
    const other = kind === 'dark' ? 'paletteLight' : 'paletteDark';
    onChange(sibling ? { [own]: id, [other]: sibling.id } : { [own]: id });
  };

  return (
    <>
      <div className="field">
        <div className="chips">
          {PREFERENCES.map((theme) => (
            <button key={theme} className={`chip${value.theme === theme ? ' chip-on' : ''}`} onClick={() => onChange({ theme })}>
              {t(`theme.${theme}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="mono-label">{t('theme.palette')}</span>
        <select value={current.id} onChange={(e) => pick(kind, e.target.value)}>
          {PALETTES.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
    </>
  );
}
