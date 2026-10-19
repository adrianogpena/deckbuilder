import { createContext, Fragment, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from 'react';
import { tryT } from '../i18n';
import { isModified, type SettingDef } from '../settings-schema';

const tr = (key: string): string => tryT(key) ?? key;

/** Resolves `#setting.id#` links in descriptions: the target's label, and what a click does. */
export interface SettingLinks {
  /** The translated label of a setting, or undefined for an unknown id. */
  labelOf: (id: string) => string | undefined;
  onNavigate: (id: string) => void;
}

const SettingLinksContext = createContext<SettingLinks | null>(null);

/** Gives every `SettingDescription` below it (the schema rows too) its links. */
export const SettingLinksProvider = SettingLinksContext.Provider;

const LINK = /#([\w.-]+)#/;

/**
 * A setting description where `#setting.id#` renders as a link showing the target's label, like VS Code. Lookup and
 * navigation come from the props, else from `SettingLinksProvider`; an unknown id renders as plain text.
 */
export function SettingDescription({ text, labelOf, onNavigate }: { text: string; labelOf?: SettingLinks['labelOf']; onNavigate?: SettingLinks['onNavigate'] }) {
  const links = useContext(SettingLinksContext);
  const label = labelOf ?? links?.labelOf;
  const go = onNavigate ?? links?.onNavigate;
  const parts = text.split(LINK);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const name = label?.(part);
        if (!name) return <Fragment key={i}>{part}</Fragment>;
        if (!go) return <Fragment key={i}>{name}</Fragment>;
        return (
          <button
            key={i}
            type="button"
            className="setting-link"
            title={part}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              go(part);
            }}
          >
            {name}
          </button>
        );
      })}
    </>
  );
}

/** What focusing a setting row (`[data-setting]`) focuses: its first control. */
export const SETTING_ROW_CONTROLS = ':is(input, select, textarea, button)';

/**
 * Returns `reveal(id)`: once the row of setting `id` (`data-setting`) renders under `root`, it scrolls into view and
 * its first control takes focus. Call it after switching the page that holds the row.
 */
export function useRevealSetting(root: RefObject<HTMLElement | null>): (id: string) => void {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    setPending(null);
    const row = root.current?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(pending)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    (row.querySelector<HTMLElement>(SETTING_ROW_CONTROLS) ?? row).focus({ preventScroll: true });
  });
  return setPending;
}

/** A boolean as one tick-box row: label on the left, checkbox on the right edge, description below the label. */
export function OnOffField({ label, hint, value, onChange }: { label: string; hint: ReactNode; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="field setting-check">
      <span className="mono-label">{label}</span>
      {hint && <span className="muted">{hint}</span>}
      <input type="checkbox" checked={value} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    </label>
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
  hint?: ReactNode;
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
          <button title={optionLabel ? optionLabel(v) : String(v)} key={String(v)} className={`chip${value === v ? ' chip-on' : ''}`} onClick={() => onChange(v)}>
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
  return (
    <SettingItem id={def.id} modified={isModified(def, settings)}>
      <SettingControl def={def} settings={settings} onChange={onChange} />
    </SettingItem>
  );
}

/** The frame of one setting row, like VS Code's settings editor: a bar at the left edge while the value differs from its default. */
export function SettingItem({ id, modified, children }: { id: string; modified: boolean; children: ReactNode }) {
  return (
    <div className={`setting-item${modified ? ' modified' : ''}`} data-setting={id}>
      {modified && <span className="setting-modified" title={tryT('settings.row.modified') ?? 'Modified'} />}
      {children}
    </div>
  );
}

function SettingControl<S>({ def, settings, onChange }: { def: SettingDef<S>; settings: S; onChange: (patch: Partial<S>) => void }) {
  if (def.kind === 'custom') return null;
  const label = tr(def.label);
  const hint = def.description ? <SettingDescription text={tr(def.description)} /> : null;
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

/**
 * For a field that edits `value` as local text: runs `resync` when `value` changes from outside (a page Reset) while
 * the returned textarea ref is not focused, so the text shows the new value.
 */
export function useResync(value: unknown, resync: () => void) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const key = JSON.stringify(value);
  const run = useRef(resync);
  run.current = resync;
  useEffect(() => {
    if (document.activeElement !== ref.current) run.current();
  }, [key]);
  return ref;
}
