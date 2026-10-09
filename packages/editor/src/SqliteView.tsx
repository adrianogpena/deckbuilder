import { ErrorBanner, errorOf, Icon, type ApiError, PanelLoading, t } from '@deckbuilder/ui';
import { useState } from 'react';
import { DataGrid } from './TableView';

/** What `/api/fs/sqlite` returns. */
export interface SqliteContent {
  tables: { name: string; view: boolean }[];
  table: string | null;
  columns: string[];
  rows: (string | number | null)[][];
  total: number;
  offset: number;
}

/** Rows per page: the server's page size. */
const PAGE = 200;

/** The tables of a SQLite file and 200 rows of the chosen one; `load` fetches another table or page. */
export function SqliteView({ content, load }: { content: SqliteContent; load(table: string, offset: number): Promise<SqliteContent> }) {
  const [current, setCurrent] = useState(content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();

  const go = async (table: string, offset: number) => {
    setBusy(true);
    setError(undefined);
    try {
      setCurrent(await load(table, offset));
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (!current.tables.length) return <div className="archive-empty">{t('preview.sqliteEmpty')}</div>;
  const from = current.total ? current.offset + 1 : 0;
  const to = current.offset + current.rows.length;
  return (
    <div className="sqlite-view">
      <div className="sqlite-tables">
        <div className="sqlite-heading">{t('preview.sqliteTables')}</div>
        {current.tables.map((tb) => (
          <button key={tb.name} className={`sqlite-table${tb.name === current.table ? ' active' : ''}`} onClick={() => void go(tb.name, 0)} disabled={busy}>
            <Icon name={tb.view ? 'search' : 'table'} size={14} /> <span>{tb.name}</span>
          </button>
        ))}
      </div>
      <div className="file-preview">
        <div className="file-preview-bar archive-bar">
          <span className="archive-summary">{t('preview.sqliteRows', { from, to, total: current.total })}</span>
          <span>
            <button className="btn btn-ghost btn-sm" disabled={busy || current.offset === 0} onClick={() => void go(current.table!, Math.max(0, current.offset - PAGE))}>
              {t('preview.previous')}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy || to >= current.total} onClick={() => void go(current.table!, current.offset + PAGE)}>
              {t('preview.next')}
            </button>
          </span>
        </div>
        {error && <ErrorBanner error={error} compact />}
        <div className="file-preview-body">
          {busy ? <PanelLoading /> : <DataGrid columns={current.columns} rows={current.rows} />}
        </div>
      </div>
    </div>
  );
}
