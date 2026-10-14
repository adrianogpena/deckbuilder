import { type ExportColumn, toCsv } from '@deckbuilder/ui';
import { api } from '../../api';
import { t } from '../../i18n';

export type ExportFormat = 'csv' | 'json';

export const EXPORT_ROWS = 10_000;

export function toJson<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const objects = rows.map((row) => Object.fromEntries(columns.map((c) => [c.label, c.value(row) ?? null])));
  return JSON.stringify(objects, null, 2);
}

/**
 * Asks where to save, then writes the first `EXPORT_ROWS` rows as CSV or JSON.
 * Returns the toast message, or undefined when the dialog was cancelled.
 */
export async function exportResults<T>(format: ExportFormat, columns: ExportColumn<T>[], rows: T[], truncated: boolean): Promise<string | undefined> {
  const { path } = await api.saveTarget(format);
  if (!path) return undefined;
  const slice = rows.slice(0, EXPORT_ROWS);
  await api.saveDemo(path, format === 'json' ? toJson(columns, slice) : toCsv(columns, slice));
  const partial = truncated || rows.length > EXPORT_ROWS;
  return t(partial ? 'workbench.exported.partial' : 'workbench.exported', { count: slice.length, path });
}
