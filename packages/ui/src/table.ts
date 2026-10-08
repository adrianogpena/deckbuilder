/** Pure model of the DataTable: sorting, windowing, selection and CSV/TSV export. */

export type SortDir = 'asc' | 'desc';
export interface SortState {
  column: string;
  dir: SortDir;
}
export interface ExportColumn<T> {
  label: string;
  value: (row: T) => unknown;
}
export interface Selection {
  keys: string[];
  anchor: string | null;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  return String(value);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const missing = (v: unknown) => v === null || v === undefined;

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(cellText(a), cellText(b));
}

/** A sorted copy; stable, and null/undefined values come last in both directions. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => unknown, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const keyed = rows.map((row, index) => ({ row, index, v: value(row) }));
  keyed.sort((x, y) => {
    const mx = missing(x.v);
    const my = missing(y.v);
    if (mx || my) return mx && my ? x.index - y.index : mx ? 1 : -1;
    return sign * compare(x.v, y.v) || x.index - y.index;
  });
  return keyed.map((k) => k.row);
}

/** Clicking the same column cycles asc → desc → none; another column starts at asc. */
export function nextSort(current: SortState | null, column: string): SortState | null {
  if (!current || current.column !== column) return { column, dir: 'asc' };
  return current.dir === 'asc' ? { column, dir: 'desc' } : null;
}

/** Rows to render for a scroll position; `end` is exclusive. */
export function visibleRange(
  scrollTop: number,
  viewportPx: number,
  rowHeight: number,
  total: number,
  overscan = 8,
): { start: number; end: number } {
  if (total <= 0 || !(rowHeight > 0)) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportPx)) / rowHeight);
  const start = Math.min(total, Math.max(0, first - overscan));
  const end = Math.min(total, Math.max(start, last + overscan));
  return { start, end };
}

// Excel runs a cell starting with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvField(value: unknown): string {
  let text = cellText(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: ExportColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => csvField(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvField(c.value(row))).join(','));
  return lines.join('\r\n');
}

const tsvField = (value: unknown) => cellText(value).replace(/[\t\r\n]+/g, ' ');

export function toTsv<T>(columns: ExportColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => tsvField(c.label)).join('\t')];
  for (const row of rows) lines.push(columns.map((c) => tsvField(c.value(row))).join('\t'));
  return lines.join('\n');
}

export function select(
  state: Selection,
  target: string,
  orderedKeys: readonly string[],
  mode: 'single' | 'toggle' | 'range',
): Selection {
  if (mode === 'toggle') {
    const keys = state.keys.includes(target) ? state.keys.filter((k) => k !== target) : [...state.keys, target];
    return { keys, anchor: target };
  }
  if (mode === 'range') {
    const from = state.anchor === null ? -1 : orderedKeys.indexOf(state.anchor);
    const to = orderedKeys.indexOf(target);
    if (from >= 0 && to >= 0) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      return { keys: orderedKeys.slice(lo, hi + 1), anchor: state.anchor };
    }
  }
  return { keys: [target], anchor: target };
}
