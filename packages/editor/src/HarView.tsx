import { formatBytes, PanelBanner, t } from '@kedalion/ui';
import { useMemo, useState } from 'react';
import { DataGrid } from './TableView';
import { compareCells } from './table';

interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request?: { method?: string; url?: string };
  response?: { status?: number; content?: { size?: number; mimeType?: string }; bodySize?: number };
}

/** A browser HAR capture as a request table with filter and sort. */
export function HarView({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      const entries = (JSON.parse(text) as { log?: { entries?: HarEntry[] } }).log?.entries;
      if (!Array.isArray(entries)) return { error: 'log.entries' };
      const rows = entries.map((e) => {
        const size = e.response?.content?.size ?? e.response?.bodySize ?? 0;
        return [
          e.request?.method ?? '',
          e.request?.url ?? '',
          String(e.response?.status ?? ''),
          (e.response?.content?.mimeType ?? '').split(';')[0]!,
          String(Math.max(0, size)),
          String(Math.round(e.time ?? 0)),
        ];
      });
      return { rows, bytes: rows.reduce((sum, r) => sum + Number(r[4]), 0) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [text]);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null);

  const rows = useMemo(() => {
    if ('error' in parsed) return [];
    const q = filter.trim().toLowerCase();
    let out = q ? parsed.rows.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : parsed.rows;
    if (sort) {
      const sign = sort.desc ? -1 : 1;
      out = [...out].sort((a, b) => sign * compareCells(a[sort.column]!, b[sort.column]!));
    }
    return out;
  }, [parsed, filter, sort]);

  if ('error' in parsed) return <PanelBanner tone="err">{t('preview.harInvalid', { message: parsed.error ?? '' })}</PanelBanner>;

  const shown = rows.slice(0, 2000).map((r) => [r[0]!, r[1]!, r[2]!, r[3]!, formatBytes(Number(r[4])), `${r[5]} ms`]);
  const onSort = (column: number) =>
    setSort((s) => (s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }));
  return (
    <div className="file-preview">
      <div className="file-preview-bar archive-bar">
        <span className="archive-summary">{t('preview.harSummary', { count: parsed.rows.length, size: formatBytes(parsed.bytes) })}</span>
        <input className="input archive-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('preview.filter')} aria-label={t('preview.filter')} />
      </div>
      <div className="file-preview-body">
        <DataGrid
          columns={[t('preview.col.method'), t('preview.col.url'), t('preview.col.status'), t('preview.col.type'), t('preview.col.size'), t('preview.col.time')]}
          rows={shown}
          sort={sort}
          onSort={onSort}
        />
      </div>
    </div>
  );
}
