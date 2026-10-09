import { useMemo, useState } from 'react';
import { type ApiError, ErrorBanner, Icon, Spinner } from '@deckbuilder/ui';
import type { DbSchema, DbSchemaTable } from '../../api';
import { t } from '../../i18n';

const MAX_SHOWN = 300;

export interface SchemaPanelProps {
  schema?: DbSchema;
  loading: boolean;
  error?: ApiError;
  onOwner: (owner: string) => void;
  onReload: () => void;
  /** Double-click on a table or view. */
  onPick: (table: DbSchemaTable, owner: string) => void;
}

/** Tables and views of one schema with their columns; the filter matches table names. */
export function SchemaPanel({ schema, loading, error, onOwner, onReload, onPick }: SchemaPanelProps) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (schema?.tables ?? []).filter((table) => table.name.toLowerCase().includes(needle));
  }, [schema, filter]);

  const toggle = (name: string) => setOpen((o) => (o.includes(name) ? o.filter((n) => n !== name) : [...o, name]));

  return (
    <aside className="wb-schema">
      <div className="wb-schema-head">
        <span className="mono-label">{t('workbench.schema')}</span>
        {loading && <Spinner small />}
        <button className="btn btn-ghost btn-sm" onClick={onReload} disabled={loading} title={t('workbench.schema.reload')} aria-label={t('workbench.schema.reload')}>
          <Icon name="refresh" />
        </button>
      </div>
      {error && <ErrorBanner error={error} compact />}
      {schema && (
        <>
          <select value={schema.owner} onChange={(e) => onOwner(e.target.value)} aria-label={t('workbench.schema.owner')} title={t('workbench.schema.owner')}>
            {!schema.owners.includes(schema.owner) && <option value={schema.owner}>{schema.owner}</option>}
            {schema.owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('workbench.schema.filter')} aria-label={t('workbench.schema.filter')} />
          <ul className="wb-schema-list">
            {matches.slice(0, MAX_SHOWN).map((table) => {
              const expanded = open.includes(table.name);
              return (
                <li key={table.name}>
                  <button className="wb-schema-table" onClick={() => toggle(table.name)} onDoubleClick={() => onPick(table, schema.owner)} title={t('workbench.schema.pick')}>
                    <Icon name={expanded ? 'chevron-down' : 'chevron'} />
                    <Icon name="table" />
                    <span className="wb-schema-name">{table.name}</span>
                    {table.kind === 'view' && <span className="muted">{t('workbench.schema.view')}</span>}
                  </button>
                  {expanded && (
                    <ul className="wb-schema-cols">
                      {table.columns.map((c) => (
                        <li key={c.name}>
                          <span className="wb-schema-name">{c.name}</span>
                          <span className="muted">{c.type}{c.nullable ? '' : ' *'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {matches.length > MAX_SHOWN && <span className="muted wb-schema-more">{t('workbench.schema.more', { count: matches.length - MAX_SHOWN })}</span>}
          {matches.length === 0 && <span className="muted wb-schema-more">{t('workbench.schema.none')}</span>}
          {schema.truncated && <span className="muted wb-schema-more">{t('workbench.schema.truncated')}</span>}
        </>
      )}
    </aside>
  );
}
