import { writeJsonAtomic } from '@deckbuilderkit/platform';
import { type BackupInspect, forbidden, invalid, isRecord, type Routes } from '@deckbuilderkit/server-core';
import type { DialogPicks } from './file-dialog.ts';
import type { ImportResult, RecordStore, Rec } from './records.ts';
import type { SettingsStore } from './settings.ts';

export interface BackupRoutesOptions {
  app: { id: string; version: string };
  settings: SettingsStore<any>;
  /** Record stores a backup may hold, by the name used in the file. */
  stores: Record<string, RecordStore<any>>;
  /** Settings keys left out of exports and imports (machine-specific ones). */
  excludeSettings?: string[];
  /** The in-app file dialog's picks: export writes to a `saveTargets` path, inspect reads an `opened` one. */
  picks: Pick<DialogPicks, 'opened' | 'saveTargets'>;
}

/** What an export writes. Secret fields are left out. */
export interface BackupFile {
  format: 'deckbuilder-backup';
  version: 1;
  app: string;
  appVersion: string;
  exportedAt: string;
  settings?: Record<string, unknown>;
  records?: Record<string, Rec<object>[]>;
}

const MAX_FILE_BYTES = 20_000_000;
const MAX_INSPECTED = 5;
const INSPECTED_TTL_MS = 600_000;
const badRequest = () => invalid('badRequest', 'Invalid request.');
const badBackup = () => invalid('badBackup', 'This file is not a valid backup.');
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

const notASaveTarget = () => forbidden('notASaveTarget', 'Choose where to save first.');

/**
 * `GET /api/backup/parts`, `POST /api/backup/export`, `POST /api/backup/inspect` and
 * `POST /api/backup/import`. Both files are chosen in the in-app file dialog: export takes the
 * `target` it committed, inspect the `path`; inspect keeps the parsed file under a one-shot token
 * that import takes.
 */
export function backupRoutes(opts: BackupRoutesOptions): Routes {
  const { app, settings, stores, excludeSettings = [], picks } = opts;
  const inspected = new Map<string, { file: BackupFile; at: number }>();

  const withoutExcluded = (values: Record<string, unknown>) => {
    const copy = { ...values };
    for (const key of excludeSettings) delete copy[key];
    return copy;
  };

  const parts = (body: unknown) => {
    if (!isRecord(body) || typeof body.settings !== 'boolean' || !isStringArray(body.stores)) throw badRequest();
    return { settings: body.settings, stores: body.stores };
  };

  async function read(path: string): Promise<BackupFile> {
    const handle = Bun.file(path);
    if (handle.size > MAX_FILE_BYTES) throw invalid('backupTooLarge', 'The backup file is too large.');
    let file: unknown;
    try {
      file = JSON.parse(await handle.text());
    } catch {
      throw badBackup();
    }
    if (!isRecord(file) || file.format !== 'deckbuilder-backup' || file.version !== 1 || typeof file.app !== 'string') throw badBackup();
    if (file.app !== app.id) throw invalid('backupOtherApp', 'This backup belongs to another app ({app}).', { app: file.app.slice(0, 100) });
    if (file.settings !== undefined && !isRecord(file.settings)) throw badBackup();
    if (file.records !== undefined && !(isRecord(file.records) && Object.values(file.records).every(Array.isArray))) throw badBackup();
    return file as unknown as BackupFile;
  }

  return {
    'GET /api/backup/parts': () => ({ stores: Object.keys(stores) }),

    'POST /api/backup/export': async ({ json }) => {
      const body = await json();
      const chosen = parts(body);
      if (chosen.stores.some((name) => !Object.hasOwn(stores, name))) throw badRequest();
      if (!chosen.settings && chosen.stores.length === 0) throw invalid('backupEmpty', 'Choose something to export.');
      const path = (body as Record<string, unknown>).target;
      if (typeof path !== 'string' || !picks.saveTargets.take(path)) throw notASaveTarget();
      const file: BackupFile = { format: 'deckbuilder-backup', version: 1, app: app.id, appVersion: app.version, exportedAt: new Date().toISOString() };
      if (chosen.settings) file.settings = withoutExcluded(await settings.load());
      const counts: Record<string, number> = {};
      if (chosen.stores.length) {
        file.records = {};
        for (const name of new Set(chosen.stores)) {
          file.records[name] = await stores[name]!.exportItems();
          counts[name] = file.records[name].length;
        }
      }
      await writeJsonAtomic(path, file, { mode: 0o600 });
      return { path, counts };
    },

    'POST /api/backup/inspect': async ({ json }): Promise<BackupInspect> => {
      const path = ((await json()) as Record<string, unknown> | null)?.path;
      if (typeof path !== 'string' || !picks.opened.take(path)) throw forbidden('notAPickedFile', 'Choose a file first.');
      const file = await read(path);
      const now = Date.now();
      for (const [key, entry] of inspected) if (now - entry.at >= INSPECTED_TTL_MS) inspected.delete(key);
      const token = crypto.randomUUID();
      inspected.set(token, { file, at: now });
      while (inspected.size > MAX_INSPECTED) inspected.delete(inspected.keys().next().value as string);
      return {
        token,
        appVersion: typeof file.appVersion === 'string' ? file.appVersion : '',
        exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
        settings: file.settings !== undefined,
        stores: Object.entries(file.records ?? {}).map(([name, items]) => ({ name, count: items.length, known: Object.hasOwn(stores, name) })),
      };
    },

    'POST /api/backup/import': async ({ json }) => {
      const body = await json();
      const chosen = parts(body);
      const mode = (body as Record<string, unknown>).mode;
      const token = (body as Record<string, unknown>).token;
      if (mode !== 'merge' && mode !== 'replace') throw badRequest();
      const entry = typeof token === 'string' ? inspected.get(token) : undefined;
      if (entry) inspected.delete(token as string);
      if (!entry || Date.now() - entry.at >= INSPECTED_TTL_MS) throw invalid('backupExpired', 'The backup file was read too long ago. Choose it again.');
      const { file } = entry;
      const applied = chosen.settings && file.settings !== undefined;
      if (applied) await settings.save(withoutExcluded(file.settings!));
      const results: Record<string, ImportResult> = {};
      for (const name of new Set(chosen.stores)) {
        if (Object.hasOwn(stores, name) && file.records && Object.hasOwn(file.records, name)) {
          results[name] = await stores[name]!.importItems(file.records[name]!, mode);
        }
      }
      return { settings: applied, stores: results };
    },
  };
}
