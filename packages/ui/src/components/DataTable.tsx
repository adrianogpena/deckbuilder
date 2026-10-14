import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { copyText } from '../hooks';
import { t } from '../i18n';
import { cellText, nextSort, select, sortRows, toTsv, visibleRange, type SortState } from '../table';
import { Icon } from './ui';

const DEFAULT_WIDTH = 160;
const HEADER_HEIGHT = 30;
const COPIED_MS = 1500;

export interface DataTableColumn<T> {
  id: string;
  label: string;
  /** Pixels; 160 when omitted. */
  width?: number;
  /** Smallest width a resize drag allows; 60 when omitted. */
  minWidth?: number;
  align?: 'left' | 'right';
  value: (row: T) => unknown;
  /** Custom cell content; the value still drives sorting and copying. */
  render?: (row: T) => ReactNode;
  /** Text copied for the cell instead of the value. */
  copy?: (row: T) => string;
  /** Header click sorts; true when omitted. */
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Pixels; fixed, since the table windows its rows. */
  rowHeight?: number;
  /** Column widths by column id. Controlled when given, else kept inside. */
  widths?: Record<string, number>;
  onWidthsChange?: (widths: Record<string, number>) => void;
  /** Controlled when given (`null` = unsorted), else kept inside. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Selected row keys. Controlled when given, else kept inside. */
  selection?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Enter or double-click on a row. */
  onRowOpen?: (row: T) => void;
  onRowContextMenu?: (row: T, e: MouseEvent) => void;
  /** Rank that orders rows before the sort column, in both directions and unsorted (lower first), e.g. folders before files. */
  groupOf?: (row: T) => number;
  /** Keys the grid handles before its own; call `e.preventDefault()` to stop the default handling. */
  onKeyDown?: (e: KeyboardEvent) => void;
  empty?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHeight = 28,
  widths,
  onWidthsChange,
  sort,
  onSortChange,
  selection,
  onSelectionChange,
  onRowOpen,
  onRowContextMenu,
  groupOf,
  onKeyDown: onKeyDownProp,
  empty,
}: DataTableProps<T>) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [ownSort, setOwnSort] = useState<SortState | null>(null);
  const [ownWidths, setOwnWidths] = useState<Record<string, number>>({});
  const [ownKeys, setOwnKeys] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const anchor = useRef<string | null>(null);
  const active = useRef<string | null>(null);
  const resize = useRef<{ id: string; startX: number; startWidth: number; min: number } | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();

  const sortState = sort !== undefined ? sort : ownSort;
  const keys = selection ?? ownKeys;
  const widthOf = (c: DataTableColumn<T>) => (widths ?? ownWidths)[c.id] ?? c.width ?? DEFAULT_WIDTH;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    setViewport(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const sorted = useMemo(() => {
    const column = sortState ? columns.find((c) => c.id === sortState.column) : undefined;
    if (sortState && column) return sortRows(rows, column.value, sortState.dir, groupOf);
    return groupOf ? sortRows(rows, () => 0, 'asc', groupOf) : rows;
  }, [rows, columns, sortState, groupOf]);
  const ordered = useMemo(() => sorted.map(rowKey), [sorted, rowKey]);
  const selected = useMemo(() => new Set(keys), [keys]);

  const totalWidth = columns.reduce((sum, c) => sum + widthOf(c), 0);
  const { start, end } = visibleRange(scrollTop, viewport, rowHeight, sorted.length);

  const changeSort = (next: SortState | null) => {
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
  };

  const changeSelection = (next: { keys: string[]; anchor: string | null }) => {
    anchor.current = next.anchor;
    if (selection === undefined) setOwnKeys(next.keys);
    onSelectionChange?.(next.keys);
  };

  const pick = (key: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const mode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single';
    active.current = key;
    changeSelection(select({ keys, anchor: anchor.current }, key, ordered, mode));
  };

  const reveal = (index: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = index * rowHeight;
    const room = el.clientHeight - HEADER_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + room) el.scrollTop = top + rowHeight - room;
  };

  const copySelection = async () => {
    const chosen = sorted.filter((row) => selected.has(rowKey(row)));
    if (chosen.length === 0) return;
    if (!(await copyText(toTsv(columns.map((c) => ({ label: c.label, value: c.copy ?? c.value })), chosen)))) return;
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      changeSelection({ keys: ordered, anchor: anchor.current ?? ordered[0] ?? null });
    } else if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      void copySelection();
    } else if (e.key === 'Escape' && keys.length > 0) {
      e.preventDefault();
      changeSelection({ keys: [], anchor: null });
    } else if (e.key === 'Enter') {
      const row = sorted[ordered.indexOf(active.current ?? keys[0] ?? '')];
      if (row !== undefined && onRowOpen) {
        e.preventDefault();
        onRowOpen(row);
      }
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ordered.length > 0) {
      e.preventDefault();
      const at = ordered.indexOf(active.current ?? '');
      const to = Math.min(ordered.length - 1, Math.max(0, at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1)));
      pick(ordered[to], { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false });
      reveal(to);
    }
  };

  const startResize = (e: PointerEvent<HTMLDivElement>, c: DataTableColumn<T>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = { id: c.id, startX: e.clientX, startWidth: widthOf(c), min: c.minWidth ?? 60 };
  };

  const moveResize = (e: PointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (!r) return;
    const next = { ...(widths ?? ownWidths), [r.id]: Math.max(r.min, Math.round(r.startWidth + e.clientX - r.startX)) };
    if (widths === undefined) setOwnWidths(next);
    onWidthsChange?.(next);
  };

  const endResize = (e: PointerEvent<HTMLDivElement>) => {
    resize.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const cells = (row: T, c: DataTableColumn<T>) => {
    const value = c.value(row);
    const text = cellText(value);
    return (
      <div key={c.id} role="gridcell" className={`dtable-cell${c.align === 'right' ? ' right' : ''}`} style={{ width: widthOf(c) }} title={text}>
        {c.render ? c.render(row) : value === null || value === undefined ? <span className="dtable-null">{t('table.null')}</span> : text}
      </div>
    );
  };

  return (
    <div className="dtable" onKeyDown={onKeyDown}>
      <div
        ref={scroller}
        className="dtable-scroll"
        role="grid"
        tabIndex={0}
        aria-rowcount={sorted.length + 1}
        aria-multiselectable="true"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="dtable-head" role="row" aria-rowindex={1} style={{ width: totalWidth, height: HEADER_HEIGHT }}>
          {columns.map((c) => {
            const sortable = c.sortable !== false;
            const dir = sortState?.column === c.id ? sortState.dir : null;
            return (
              <div
                key={c.id}
                role="columnheader"
                aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                className={`dtable-hcell${sortable ? ' sortable' : ''}${c.align === 'right' ? ' right' : ''}`}
                style={{ width: widthOf(c) }}
                title={c.label}
                onClick={sortable ? () => changeSort(nextSort(sortState, c.id)) : undefined}
              >
                <span className="dtable-label">{c.label}</span>
                {dir && (
                  <span className={`dtable-sort${dir === 'asc' ? ' asc' : ''}`}>
                    <Icon name="chevron-down" size={12} />
                  </span>
                )}
                <div
                  className="dtable-grip"
                  onPointerDown={(e) => startResize(e, c)}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            );
          })}
        </div>
        {sorted.length === 0 ? (
          <div className="dtable-empty">{empty ?? t('table.empty')}</div>
        ) : (
          <div className="dtable-body" style={{ width: totalWidth, height: sorted.length * rowHeight }}>
            {sorted.slice(start, end).map((row, i) => {
              const index = start + i;
              const key = ordered[index];
              return (
                <div
                  key={key}
                  role="row"
                  aria-rowindex={index + 2}
                  aria-selected={selected.has(key)}
                  className={`dtable-row${selected.has(key) ? ' selected' : ''}`}
                  style={{ height: rowHeight, transform: `translateY(${index * rowHeight}px)` }}
                  onClick={(e) => pick(key, e)}
                  onDoubleClick={() => onRowOpen?.(row)}
                  onContextMenu={(e) => {
                    if (!onRowContextMenu) return;
                    e.preventDefault();
                    if (!selected.has(key)) pick(key, { shiftKey: false, ctrlKey: false, metaKey: false });
                    onRowContextMenu(row, e);
                  }}
                >
                  {columns.map((c) => cells(row, c))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="dtable-status" role="status" aria-live="polite">
        {copied ? t('table.copied') : ''}
      </div>
    </div>
  );
}
