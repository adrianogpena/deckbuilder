import { useEffect, useState } from 'react';
import { Button, Modal, OnOffField, validConfig, type PanelConfig, type PanelField } from '@deckbuilderkit/ui';
import { tKey } from './i18n';

function NumberInput({ field, value, onChange }: { field: Extract<PanelField, { kind: 'number' }>; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText((prev) => (Number(prev) === value ? prev : String(value))), [value]);
  return (
    <input
      type="number"
      value={text}
      min={field.min}
      max={field.max}
      aria-label={tKey(field.label)}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function FieldRow({ field, value, onChange }: { field: PanelField; value: unknown; onChange: (value: unknown) => void }) {
  const hint = field.description ? tKey(field.description) : undefined;
  switch (field.kind) {
    case 'boolean':
      return <OnOffField label={tKey(field.label)} hint={hint} value={value === true} onChange={onChange} />;
    case 'number':
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <NumberInput field={field} value={typeof value === 'number' ? value : field.default} onChange={onChange} />
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    case 'string':
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <input
            value={typeof value === 'string' ? value : field.default}
            placeholder={field.placeholder ? tKey(field.placeholder) : undefined}
            maxLength={field.maxLength}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    case 'enum':
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <select value={String(value)} onChange={(e) => onChange(field.values.find((v) => String(v) === e.target.value) ?? field.default)}>
            {field.values.map((v) => (
              <option key={String(v)} value={String(v)}>{field.optionLabel ? tKey(`${field.optionLabel}.${v}`) : String(v)}</option>
            ))}
          </select>
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
  }
}

/** A form generated from the fields of a panel kind. */
export function ConfigForm({ fields, value, onChange }: { fields: readonly PanelField[]; value: PanelConfig; onChange: (value: PanelConfig) => void }) {
  return (
    <div className="grid-config-form">
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} value={value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} />
      ))}
    </div>
  );
}

/** Dialog to edit the config of one panel instance; saving gives the cleaned config. */
export function ConfigDialog({ name, fields, value, onSave, onClose }: {
  name: string;
  fields: readonly PanelField[];
  value: PanelConfig;
  onSave: (config: PanelConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => validConfig(fields, value));
  const save = () => {
    onSave(validConfig(fields, draft));
    onClose();
  };
  return (
    <Modal
      title={tKey('grid.configure.title', { name })}
      onClose={onClose}
      footer={
        <>
          <Button title={tKey('grid.cancel')} onClick={onClose}>{tKey('grid.cancel')}</Button>
          <Button variant="primary" title={tKey('grid.apply')} onClick={save}>{tKey('grid.apply')}</Button>
        </>
      }
    >
      <ConfigForm fields={fields} value={draft} onChange={setDraft} />
    </Modal>
  );
}
