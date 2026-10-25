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

const toJson = <T>(cols: CopyColumn<T>[], rows: readonly T[]): string =>
  JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c.label, c.raw(r) ?? null]))), null, 2);

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** One SQL literal: null → NULL, numbers bare only in a number column, anything else single-quoted. */
export function sqlLiteral(value: unknown, type?: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (type === 'number' && NUMERIC.test(text)) return text;
  return `'${text.replace(/'/g, "''")}'`;
}

const toInserts = <T>(cols: CopyColumn<T>[], rows: readonly T[], table: string): string => {
  const names = cols.map((c) => c.label).join(', ');
  return rows.map((r) => `INSERT INTO ${table} (${names}) VALUES (${cols.map((c) => sqlLiteral(c.raw(r), c.type)).join(', ')});`).join('\n');
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
