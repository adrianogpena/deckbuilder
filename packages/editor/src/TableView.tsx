import { PanelBanner, t } from '@deckbuilder/ui';
import { type ReactNode, useMemo, useState } from 'react';
import { compareCells, delimiterOf, parseDelimited } from './table';

/** Most rows drawn at once; the filter and the sort still cover all of them. */
export const TABLE_ROW_LIMIT = 2000;

type Cell = string | number | null;

/** A header row and cells, with an optional row-number column and sortable headers. */
export function DataGrid({ columns, rows, onSort, sort }: {
  columns: ReactNode[];
  rows: Cell[][];
  sort?: { column: number; desc: boolean } | null;
  onSort?(column: number): void;
}) {
  return (
    <table className="data-grid">
      <thead>
        <tr>
          <th className="data-grid-n">#</th>
          {columns.map((c, i) => (
            <th key={i} onClick={onSort ? () => onSort(i) : undefined} className={onSort ? 'sortable' : undefined}>
              {c}{sort?.column === i && <span aria-hidden> {sort.desc ? '▼' : '▲'}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            <td className="data-grid-n">{r + 1}</td>
            {columns.map((_, c) => (
              <td key={c} className={row[c] === null || row[c] === undefined ? 'data-grid-null' : undefined} title={String(row[c] ?? '')}>{row[c] ?? 'NULL'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A CSV or TSV file as a table: the first line is the header; filter on any cell, sort by a header. */
export function TableView({ name, text, truncated }: { name: string; text: string; truncated?: boolean }) {
  const parsed = useMemo(() => {
    const all = parseDelimited(text, delimiterOf(name, text));
    const width = all.reduce((max, r) => Math.max(max, r.length), 0);
    const header = (all[0] ?? []).slice();
    while (header.length < width) header.push('');
    return { header, body: all.slice(1) };
  }, [name, text]);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = q ? parsed.body.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : parsed.body;
    if (sort) {
      const sign = sort.desc ? -1 : 1;
      out = [...out].sort((a, b) => sign * compareCells(a[sort.column] ?? '', b[sort.column] ?? ''));
    }
    return out;
  }, [parsed, filter, sort]);

  const onSort = (column: number) =>
    setSort((s) => (s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }));

  return (
    <div className="file-preview">
      {truncated && <PanelBanner tone="warn" icon="alert">{t('preview.truncated')}</PanelBanner>}
      <div className="file-preview-bar archive-bar">
        <span className="archive-summary">
          {t('preview.rows', { shown: rows.length, total: parsed.body.length })} · {t('preview.columns', { count: parsed.header.length })}
        </span>
        <input className="input archive-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('preview.filter')} aria-label={t('preview.filter')} />
      </div>
      {rows.length > TABLE_ROW_LIMIT && <PanelBanner tone="warn" icon="alert">{t('preview.rowsCapped', { max: TABLE_ROW_LIMIT })}</PanelBanner>}
      <div className="file-preview-body">
        {parsed.header.length === 0
          ? <div className="archive-empty">{t('preview.empty')}</div>
          : <DataGrid columns={parsed.header} rows={rows.slice(0, TABLE_ROW_LIMIT)} sort={sort} onSort={onSort} />}
      </div>
    </div>
  );
}
