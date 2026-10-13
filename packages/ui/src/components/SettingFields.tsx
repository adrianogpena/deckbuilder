import { useState } from 'react';
import { tryT } from '../i18n';
import type { SettingDef } from '../settings-schema';

const tr = (key: string): string => tryT(key) ?? key;

/** A boolean as VS Code shows it: one checkbox whose label is the description. */
export function OnOffField({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="field">
      <span className="mono-label">{label}</span>
      <label className="setting-check">
        <input type="checkbox" checked={value} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
        {hint && <span className="muted">{hint}</span>}
      </label>
    </div>
  );
}

export function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max?: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <label className="field">
      <span className="mono-label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isInteger(n) && n >= min && (max === undefined || n <= max)) onChange(n);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (text: string) => void }) {
  return (
    <label className="field">
      <span className="mono-label">{label}</span>
      <input value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Enum as chips; `optionLabel` maps a value to its text (default: the value itself). */
export function EnumField<V extends string | number>({ label, hint, value, values, optionLabel, onChange }: {
  label: string;
  hint?: string;
  value: V;
  values: readonly V[];
  optionLabel?: (value: V) => string;
  onChange: (value: V) => void;
}) {
  return (
    <div className="field">
      <span className="mono-label">{label}</span>
      <div className="chips">
        {values.map((v) => (
          <button key={String(v)} className={`chip${value === v ? ' chip-on' : ''}`} onClick={() => onChange(v)}>
            {optionLabel ? optionLabel(v) : String(v)}
          </button>
        ))}
      </div>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

/**
 * Renders one schema entry bound to `settings`; `onChange` gets the patch from the entry's `set`.
 * Label/description are i18n keys; enum chips use `<label>.<value>` when that key exists, else the raw value.
 * `custom` entries render nothing (the screen renders them).
 */
export function SettingRow<S>({ def, settings, onChange }: { def: SettingDef<S>; settings: S; onChange: (patch: Partial<S>) => void }) {
  if (def.kind === 'custom') return null;
  const label = tr(def.label);
  const hint = def.description ? tr(def.description) : '';
  switch (def.kind) {
    case 'boolean':
      return <OnOffField label={label} hint={hint} value={def.get(settings)} onChange={(v) => onChange(def.set(settings, v))} />;
    case 'number':
      return <NumberField label={label} value={def.get(settings)} min={def.min ?? 0} max={def.max} onChange={(v) => onChange(def.set(settings, v))} />;
    case 'string':
      return <TextField label={label} value={def.get(settings)} onChange={(v) => onChange(def.set(settings, v))} />;
    case 'enum':
      return (
        <EnumField
          label={label}
          hint={hint}
          value={def.get(settings)}
          values={def.values}
          optionLabel={(v) => tryT(`${def.label}.${v}`) ?? tryT(`settings.value.${v}`) ?? String(v)}
          onChange={(v) => onChange(def.set(settings, v))}
        />
      );
  }
}
