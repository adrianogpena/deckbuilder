import { Database } from 'bun:sqlite';

/** What `/api/fs/sqlite` returns: the tables of a database file and one page of one table. */
export interface SqliteContent {
  tables: { name: string; view: boolean }[];
  table: string | null;
  columns: string[];
  /** Cells are numbers, strings, null or a short description of a blob. */
  rows: (string | number | null)[][];
  total: number;
  offset: number;
}

export const SQLITE_PAGE = 200;

const cell = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return `<blob ${v.length} bytes>`;
  return String(v);
};

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Opens `file` read-only and reads one page of `table` (the first table when null). */
export function readSqlite(file: string, table: string | null, offset: number): SqliteContent {
  const db = new Database(file, { readonly: true });
  try {
    const tables = db
      .query<{ name: string; type: string }, []>("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((t) => ({ name: t.name, view: t.type === 'view' }));
    const chosen = tables.find((t) => t.name === table) ?? tables[0];
    if (!chosen) return { tables, table: null, columns: [], rows: [], total: 0, offset: 0 };
    const target = quote(chosen.name);
    const total = db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${target}`).get()?.n ?? 0;
    const statement = db.query(`SELECT * FROM ${target} LIMIT ${SQLITE_PAGE} OFFSET ${Math.max(0, Math.floor(offset))}`);
    const columns = statement.columnNames;
    const rows = statement.values().map((row) => (row as unknown[]).map(cell));
    return { tables, table: chosen.name, columns, rows, total, offset: Math.max(0, Math.floor(offset)) };
  } finally {
    db.close();
  }
}
