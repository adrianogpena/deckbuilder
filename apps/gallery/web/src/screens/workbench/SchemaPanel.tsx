import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { type ApiError, ContextMenu, ErrorBanner, Icon, Spinner, useToast } from '@deckbuilder/ui';
import type { DbSchema, DbSchemaTable, DbTableConstraint } from '../../api';
import { t } from '../../i18n';
import type { TableDetailsEntry } from '@deckbuilder/sql-ui';

const MAX_SHOWN = 300;
const HIT_MS = 1500;

export interface SchemaPanelProps {
  schema?: DbSchema;
  loading: boolean;
  error?: ApiError;
  onOwner: (owner: string) => void;
  onReload: () => void;
  /** Double-click on a table or view. */
  onPick: (table: DbSchemaTable, owner: string) => void;
  /** Indexes, constraints and DDL per table, from `useTableDetails`. */
  details: { get: (owner: string, name: string) => TableDetailsEntry | undefined; load: (owner: string, name: string) => Promise<unknown> };
  onDdl: (table: DbSchemaTable, owner: string) => void;
}

/** Tables and views of one schema with their columns, indexes and constraints; the filter matches table names. */
export function SchemaPanel({ schema, loading, error, onOwner, onReload, onPick, details, onDdl }: SchemaPanelProps) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const [hit, setHit] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; table: DbSchemaTable }>();
  const list = useRef<HTMLUListElement>(null);
  const toast = useToast();
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (schema?.tables ?? []).filter((table) => table.name.toLowerCase().includes(needle));
  }, [schema, filter]);

  const expand = (name: string) => {
    if (schema) void details.load(schema.owner, name);
    setOpen((o) => (o.includes(name) ? o : [...o, name]));
  };
  const toggle = (name: string) => (open.includes(name) ? setOpen((o) => o.filter((n) => n !== name)) : expand(name));

  // Scrolls the jumped-to table into view and focuses it once it renders; the highlight fades after a moment.
  useEffect(() => {
    if (!hit) return;
    const button = list.current?.querySelector<HTMLButtonElement>(`[data-table="${CSS.escape(hit)}"]`);
    button?.scrollIntoView({ block: 'nearest' });
    button?.focus();
    const timer = window.setTimeout(() => setHit(undefined), HIT_MS);
    return () => window.clearTimeout(timer);
  }, [hit]);

  const jump = (ref: NonNullable<DbTableConstraint['references']>) => {
    const target = schema?.owner === ref.owner && schema.tables.find((table) => table.name === ref.table);
    if (!target) {
      toast({ message: t('workbench.schema.fkElsewhere', { name: `${ref.owner}.${ref.table}` }) });
      return;
    }
    if (!matches.slice(0, MAX_SHOWN).includes(target)) setFilter(target.name);
    expand(target.name);
    setHit(target.name);
  };

  const openMenu = (e: MouseEvent, table: DbSchemaTable) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, table });
  };

  return (
    <aside className="wb-schema">
      <div className="wb-schema-head">
        <span className="mono-label">{t('workbench.schema')}</span>
        {loading && <Spinner small />}
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onReload} disabled={loading} title={t('workbench.schema.reload')} aria-label={t('workbench.schema.reload')}>
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
          <ul className="wb-schema-list" ref={list}>
            {matches.slice(0, MAX_SHOWN).map((table) => {
              const expanded = open.includes(table.name);
              return (
                <li key={table.name}>
                  <button
                    className={`wb-schema-table${hit === table.name ? ' wb-schema-hit' : ''}`}
                    data-table={table.name}
                    onClick={() => toggle(table.name)}
                    onDoubleClick={() => onPick(table, schema.owner)}
                    onContextMenu={(e) => openMenu(e, table)}
                    title={t('workbench.schema.pick')}
                  >
                    <Icon name={expanded ? 'chevron-down' : 'chevron'} />
                    <Icon name="table" />
                    <span className="wb-schema-name">{table.name}</span>
                    {table.kind === 'view' && <span className="muted">{t('workbench.schema.view')}</span>}
                  </button>
                  {expanded && (
                    <TableDetails
                      table={table}
                      entry={details.get(schema.owner, table.name)}
                      onDdl={() => onDdl(table, schema.owner)}
                      onJump={jump}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {matches.length > MAX_SHOWN && <span className="muted wb-schema-more">{t('workbench.schema.more', { count: matches.length - MAX_SHOWN })}</span>}
          {matches.length === 0 && <span className="muted wb-schema-more">{t('workbench.schema.none')}</span>}
          {schema.truncated && <span className="muted wb-schema-more">{t('workbench.schema.truncated')}</span>}
          {menu && (
            <ContextMenu
              at={menu}
              onClose={() => setMenu(undefined)}
              items={[
                { id: 'pick', label: t('workbench.schema.selectRows'), icon: 'play', run: () => onPick(menu.table, schema.owner) },
                { id: 'ddl', label: t('workbench.schema.showDdl'), icon: 'code', run: () => onDdl(menu.table, schema.owner) },
              ]}
            />
          )}
        </>
      )}
    </aside>
  );
}

const CONSTRAINT_TYPES: Record<DbTableConstraint['type'], 'workbench.schema.pk' | 'workbench.schema.uk' | 'workbench.schema.fk' | 'workbench.schema.ck'> = {
  P: 'workbench.schema.pk',
  U: 'workbench.schema.uk',
  R: 'workbench.schema.fk',
  C: 'workbench.schema.ck',
};

function TableDetails({ table, entry, onDdl, onJump }: {
  table: DbSchemaTable;
  entry?: TableDetailsEntry;
  onDdl: () => void;
  onJump: (ref: NonNullable<DbTableConstraint['references']>) => void;
}) {
  const data = entry?.data;
  return (
    <div className="wb-schema-details">
      <ul className="wb-schema-cols">
        {table.columns.map((c) => (
          <li key={c.name}>
            <span className="wb-schema-name">{c.name}</span>
            <span className="muted">{c.type}{c.nullable ? '' : ' *'}</span>
          </li>
        ))}
      </ul>
      {entry?.loading && <Spinner small />}
      {entry?.error && <ErrorBanner error={entry.error} compact />}
      {data && (
        <>
          <div className="wb-schema-section mono-label">{t('workbench.schema.indexes')}</div>
          <ul className="wb-schema-cols">
            {data.indexes.length === 0 && <li className="muted">{t('workbench.schema.noIndexes')}</li>}
            {data.indexes.map((ix) => (
              <li key={ix.name} title={ix.columns.join(', ')}>
                <span className="wb-schema-name">{ix.name}</span>
                <span className="muted">{ix.unique ? `${t('workbench.schema.unique')} ` : ''}({ix.columns.join(', ')})</span>
              </li>
            ))}
          </ul>
          <div className="wb-schema-section mono-label">{t('workbench.schema.constraints')}</div>
          <ul className="wb-schema-cols">
            {data.constraints.length === 0 && <li className="muted">{t('workbench.schema.noConstraints')}</li>}
            {data.constraints.map((c) => {
              const detail = c.type === 'C' ? (c.condition ?? '') : `(${c.columns.join(', ')})`;
              const label = (
                <>
                  <span className="wb-schema-kind">{t(CONSTRAINT_TYPES[c.type])}</span>
                  <span className="wb-schema-name">{c.name}</span>
                </>
              );
              return (
                <li key={c.name} title={detail}>
                  {c.references ? (
                    <button
                      className="wb-schema-fk"
                      onClick={() => onJump(c.references!)}
                      title={t('workbench.schema.fkJump', { name: `${c.references.owner}.${c.references.table}` })}
                    >
                      {label}
                      <Icon name="link" />
                      <span className="muted">{c.references.table}</span>
                    </button>
                  ) : (
                    <>
                      {label}
                      <span className="muted wb-schema-detail">{detail}</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <button className="btn btn-ghost btn-sm wb-schema-ddl" onClick={onDdl}>
            <Icon name="code" /> {t('workbench.schema.showDdl')}
          </button>
        </>
      )}
    </div>
  );
}
