import { useState, type FormEvent, type ReactNode } from 'react';
import { errorOf, type ApiError } from '../api';
import { t } from '../i18n';
import type { IconName } from '../icons';
import { Empty, ErrorBanner, Icon, useDialogs } from './ui';

export interface ResourceListProps<T extends { id: string }> {
  items: T[];
  titleOf(item: T): string;
  subtitleOf?(item: T): string;
  iconOf?(item: T): IconName;
  onOpen(item: T): void;
  onEdit(item: T): void;
  onDelete(item: T): void;
  onAdd(): void;
  emptyTitle: string;
  /** Text of the delete confirmation; defaults to "Delete {name}?". */
  deleteBodyOf?(item: T): string;
}

/** Rows of saved items with edit and delete buttons and an Add button. Delete asks in a dialog first. */
export function ResourceList<T extends { id: string }>({ items, titleOf, subtitleOf, iconOf, onOpen, onEdit, onDelete, onAdd, emptyTitle, deleteBodyOf }: ResourceListProps<T>) {
  const { confirm, element } = useDialogs();

  const askDelete = async (item: T) => {
    const ok = await confirm({
      title: t('resource.deleteTitle'),
      body: deleteBodyOf?.(item) ?? t('dialog.confirmDelete', { name: titleOf(item) }),
      okLabel: t('resource.delete'),
      danger: true,
    });
    if (ok) onDelete(item);
  };

  return (
    <div className="resource-list">
      {element}
      <div className="resource-head">
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          <Icon name="plus" /> {t('resource.add')}
        </button>
      </div>
      {items.length === 0 ? (
        <Empty title={emptyTitle} />
      ) : (
        <ul className="resource-rows">
          {items.map((item) => {
            const subtitle = subtitleOf?.(item);
            const icon = iconOf?.(item);
            return (
              <li key={item.id} className="resource-row">
                <button className="resource-open" onClick={() => onOpen(item)}>
                  {icon && <Icon name={icon} />}
                  <span className="resource-text">
                    <span className="resource-title">{titleOf(item)}</span>
                    {subtitle && <span className="resource-sub">{subtitle}</span>}
                  </span>
                </button>
                <button className="btn btn-ghost btn-sm resource-btn" onClick={() => onEdit(item)} title={t('resource.edit')} aria-label={t('resource.edit')}>
                  <Icon name="edit" />
                </button>
                <button className="btn btn-ghost btn-sm resource-btn" onClick={() => askDelete(item)} title={t('resource.delete')} aria-label={t('resource.delete')}>
                  <Icon name="trash" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'number' | 'select' | 'path';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
}

export interface ResourceFormProps {
  fields: FieldSpec[];
  value: Record<string, unknown>;
  onSubmit(values: Record<string, unknown>): void;
  /** Without it the form has no Cancel button. */
  onCancel?(): void;
  /** Opens a picker for a `path` field, which is then read-only; the path it resolves to fills the field, null leaves it unchanged. */
  onBrowse?(key: string): Promise<string | null>;
  error?: ApiError;
  /** Extra buttons (`type="button"`) left of Cancel; `values()` gives what Save would submit, without the required check. */
  actions?(values: () => Record<string, unknown>): ReactNode;
}

const hasSecret = (v: unknown) => typeof v === 'object' && v !== null && (v as { hasSecret?: unknown }).hasSecret === true;

/** Form for one item. A `password` field whose value is `{ hasSecret: true }` shows "Saved": typing replaces the secret, Clear removes it, untouched is left out of the submit. */
export function ResourceForm({ fields, value, onSubmit, onCancel, onBrowse, error, actions }: ResourceFormProps) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      const v = value[f.key];
      if (f.kind === 'password') continue;
      init[f.key] = v === undefined || v === null ? (f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '') : String(v);
    }
    return init;
  });
  const [missing, setMissing] = useState<string[]>([]);
  const [browseError, setBrowseError] = useState<ApiError>();
  const set = (key: string, text: string) => setDraft((d) => ({ ...d, [key]: text }));

  const values = () => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const text = draft[f.key];
      if (f.kind === 'password' || f.kind === 'number') {
        if (text === undefined || (text === '' && f.kind === 'number') || (text === '' && !hasSecret(value[f.key]))) continue;
        out[f.key] = f.kind === 'number' ? Number(text) : text;
      } else {
        out[f.key] = text ?? '';
      }
    }
    return out;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const absent = fields.filter((f) => f.required && !(draft[f.key]?.trim() || (f.kind === 'password' && draft[f.key] === undefined && hasSecret(value[f.key])))).map((f) => f.key);
    setMissing(absent);
    if (absent.length) return;
    onSubmit(values());
  };

  return (
    <form className="resource-form" onSubmit={submit} noValidate>
      {error && <ErrorBanner error={error} compact />}
      {browseError && <ErrorBanner error={browseError} compact />}
      {fields.map((f) => {
        const text = draft[f.key];
        const saved = f.kind === 'password' && hasSecret(value[f.key]) && text === undefined;
        const common = {
          id: `rf-${f.key}`,
          value: text ?? '',
          placeholder: saved ? t('resource.saved') : f.placeholder,
          onChange: (e: { target: { value: string } }) => set(f.key, e.target.value),
        };
        return (
          <div key={f.key} className="field">
            <label htmlFor={common.id}>{f.label}</label>
            {f.kind === 'select' ? (
              <select {...common}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.kind === 'path' ? (
              <div className="row">
                <input {...common} type="text" readOnly={!!onBrowse} />
                {onBrowse && (
                  <button type="button" className="btn btn-sm" onClick={async () => {
                    try {
                      const picked = await onBrowse(f.key);
                      setBrowseError(undefined);
                      if (picked !== null) set(f.key, picked);
                    } catch (err) {
                      setBrowseError(errorOf(err));
                    }
                  }}>
                    {t('resource.browse')}
                  </button>
                )}
              </div>
            ) : f.kind === 'password' ? (
              <div className="row">
                <input {...common} type="password" autoComplete="new-password" />
                {saved && (
                  <button type="button" className="btn btn-sm" onClick={() => set(f.key, '')}>
                    {t('resource.clear')}
                  </button>
                )}
              </div>
            ) : (
              <input {...common} type={f.kind === 'number' ? 'number' : 'text'} />
            )}
            {missing.includes(f.key) && <span className="resource-required">{t('resource.required', { field: f.label })}</span>}
          </div>
        );
      })}
      <div className="resource-actions">
        {actions?.(values)}
        {onCancel && <button type="button" className="btn" onClick={onCancel}>{t('resource.cancel')}</button>}
        <button type="submit" className="btn btn-primary">{t('resource.save')}</button>
      </div>
    </form>
  );
}
