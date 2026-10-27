import { toCsv, toTsv } from '@kedalion/ui/table';

export const COPY_FORMATS = ['tsv', 'csv', 'markdown', 'json', 'insert'] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

export interface CopyColumn<T> {
  label: string;
  /** The cell as displayed (used by tsv, csv and markdown). */
  text: (row: T) => string;
  /** The raw cell value (used by json and insert). */
  raw: (row: T) => unknown;
  /** `'number'` columns are written unquoted by `insert`; unknown types are quoted. */
  type?: string;
  /** A TIMESTAMP column: `insert` writes its `'date'` values with TO_TIMESTAMP instead of TO_DATE. */
  timestamp?: boolean;
}

export const DEFAULT_TABLE_NAME = 'table_name';

const SIMPLE_SELECT = /^\s*select\b[\s\S]*?\bfrom\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s*(?:where\b|order\b|group\b|having\b|fetch\b|;|$)/i;

/** The table of a simple `select ... from <name>` statement, else `table_name`. */
export function tableOf(sql: string | undefined): string {
  if (!sql) return DEFAULT_TABLE_NAME;
  const m = SIMPLE_SELECT.exec(sql);
  return m ? m[1]!.replace(/\s*\.\s*/g, '.') : DEFAULT_TABLE_NAME;
}

const mdCell = (text: string) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');

const toMarkdown = <T>(cols: CopyColumn<T>[], rows: readonly T[]): string => {
  const line = (cells: string[]) => `| ${cells.map(mdCell).join(' | ')} |`;
  return [line(cols.map((c) => c.label)), line(cols.map(() => '---')), ...rows.map((r) => line(cols.map((c) => c.text(r))))].join('\n');
};

/** JSON keys for `labels`: a repeated label gets `_2`, `_3`... (`ID`, `ID_2`) so no column is lost. */
export function uniqueLabels(labels: string[]): string[] {
  const used = new Set<string>();
  return labels.map((label) => {
    let key = label;
    for (let n = 2; used.has(key); n++) key = `${label}_${n}`;
    used.add(key);
    return key;
  });
}

const toJson = <T>(cols: CopyColumn<T>[], rows: readonly T[]): string => {
  const keys = uniqueLabels(cols.map((c) => c.label));
  return JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c, i) => [keys[i], c.raw(r) ?? null]))), null, 2);
};

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(\.\d+)?)?/;

/**
 * One SQL literal: null → NULL, numbers bare only in a number column, an ISO value in a date column as
 * TO_DATE (TO_TIMESTAMP when `timestamp`), anything else single-quoted.
 */
export function sqlLiteral(value: unknown, type?: string, timestamp?: boolean): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (type === 'number' && NUMERIC.test(text)) return text;
  const date = type === 'date' ? ISO_DATE.exec(text) : null;
  if (date) {
    const time = date[2] ?? '00:00:00';
    if (timestamp) return `TO_TIMESTAMP('${date[1]} ${time}${date[3] ?? ''}', 'YYYY-MM-DD HH24:MI:SS${date[3] ? '.FF' : ''}')`;
    return `TO_DATE('${date[1]} ${time}', 'YYYY-MM-DD HH24:MI:SS')`;
  }
  return `'${text.replace(/'/g, "''")}'`;
}

/** A column name as written in SQL: a plain uppercase identifier bare, anything else double-quoted. */
const sqlName = (label: string) => (/^[A-Z][A-Z0-9_$#]*$/.test(label) ? label : `"${label.replace(/"/g, '""')}"`);

const toInserts = <T>(cols: CopyColumn<T>[], rows: readonly T[], table: string): string => {
  const names = cols.map((c) => sqlName(c.label)).join(', ');
  return rows.map((r) => `INSERT INTO ${table} (${names}) VALUES (${cols.map((c) => sqlLiteral(c.raw(r), c.type, c.timestamp)).join(', ')});`).join('\n');
};

/** The clipboard text of `rows` in `format`. */
export function formatCopy<T>(format: CopyFormat, cols: CopyColumn<T>[], rows: readonly T[], sql?: string): string {
  const display = cols.map((c) => ({ label: c.label, value: c.text }));
  switch (format) {
    case 'csv':
      return toCsv(display, rows);
    case 'markdown':
      return toMarkdown(cols, rows);
    case 'json':
      return toJson(cols, rows);
    case 'insert':
      return toInserts(cols, rows, tableOf(sql));
    default:
      return toTsv(display, rows);
  }
}
