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

export interface ResultFormat {
  /** Shown for a null cell. */
  nullText: string;
  /** Pattern for DATE columns; tokens `yyyy MM dd HH mm ss SSS`. */
  dateFormat: string;
  /** A DATE at 00:00:00 shows its date part only. */
  hideMidnight: boolean;
  /** Pattern for TIMESTAMP columns; same tokens. */
  timestampFormat: string;
  /** Group the integer digits of numbers by thousands. */
  thousandsSeparator: boolean;
}

export const DEFAULT_RESULT_FORMAT: ResultFormat = {
  nullText: '',
  dateFormat: 'yyyy-MM-dd HH:mm:ss',
  hideMidnight: false,
  timestampFormat: 'yyyy-MM-dd HH:mm:ss.SSS',
  thousandsSeparator: false,
};

export type FormatColumnType = 'number' | 'text' | 'date' | 'binary';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const PLAIN_NUMBER = /^([+-]?)(\d+)(\.\d*)?$/;

/** The date part of a pattern: everything before the first time token, without trailing separators. */
function dateOnly(pattern: string): string {
  const i = pattern.search(/HH|mm|ss|SSS/);
  return (i < 0 ? pattern : pattern.slice(0, i)).replace(/[\s:T.,-]+$/, '');
}

function formatDate(m: RegExpExecArray, pattern: string): string {
  const [, yyyy, MM, dd, HH = '00', mm = '00', ss = '00', frac = ''] = m;
  const parts: Record<string, string> = { yyyy: yyyy!, MM: MM!, dd: dd!, HH, mm, ss, SSS: frac.padEnd(3, '0').slice(0, 3) };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss|SSS/g, (token) => parts[token]!);
}

/** Display text of one result cell; `dim` marks a null. `temporal` tells a TIMESTAMP column from a DATE one. */
export function formatCell(
  value: unknown,
  type: FormatColumnType,
  format: ResultFormat,
  temporal: 'date' | 'timestamp' = 'date',
): { text: string; dim: boolean } {
  if (value === null || value === undefined) return { text: format.nullText, dim: true };
  const text = cellText(value);
  if (type === 'date' && typeof value === 'string') {
    const m = ISO_DATE.exec(value);
    if (m) {
      const midnight = (m[4] ?? '00') === '00' && (m[5] ?? '00') === '00' && (m[6] ?? '00') === '00';
      if (temporal === 'date' && format.hideMidnight && midnight) return { text: formatDate(m, dateOnly(format.dateFormat)), dim: false };
      return { text: formatDate(m, temporal === 'timestamp' ? format.timestampFormat : format.dateFormat), dim: false };
    }
  }
  if (type === 'number' && format.thousandsSeparator && (typeof value === 'string' || typeof value === 'number')) {
    const m = PLAIN_NUMBER.exec(text);
    if (m) return { text: `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+$)/g, ',')}${m[3] ?? ''}`, dim: false };
  }
  return { text, dim: false };
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
