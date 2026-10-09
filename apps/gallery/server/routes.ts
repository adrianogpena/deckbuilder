import { statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { appHome, createToaster, openWithDefault, pickFile, revealInFolder, saveFileAs, secretStore, writeFileAtomic } from '@deckbuilder/platform';
import type { HttpRequestDraft } from '@deckbuilder/editor/http';
import { AppError, forbidden, invalid, isRecord, ndjson, type Routes } from '@deckbuilder/server-core';
import { dialogRoutes, editorRoutes, fromPlatform, httpExecutor, httpRoutes, pickedPaths, recordRoutes, recordStore, rootedFs, validateDraft } from '@deckbuilder/server-mods';
import type { StartContext } from '@deckbuilder/shell';
import { APP } from '../app.ts';

const toaster = createToaster();

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Folders the folder dialog returned; a project path must be one of them (taken once). */
const pickedFolders = pickedPaths();

/** The folders the Explorer screen shows; each is a root of the rooted file system. */
export const projects = recordStore<{ name: string; path: string }>({
  dir: appHome(APP.id),
  name: 'projects',
  validate(input, prev, ctx) {
    const { name, path } = (input ?? {}) as { name?: unknown; path?: unknown };
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 80) throw invalid('badProjectName', 'The name must have 1 to 80 characters.');
    // An unchanged path skips the stat: it would block the server while a share is offline.
    if (typeof path === 'string' && path === prev?.path) return { name: trimmed, path };
    // A backup's path was not picked here, but the user picked the backup file in a dialog.
    if (typeof path !== 'string' || !(ctx?.imported || pickedFolders.take(path))) throw invalid('pickFolderFirst', 'Choose the folder with Browse.');
    if (!isAbsolute(path) || !isDirectory(path)) throw invalid('badProjectPath', 'The path must be an existing folder.');
    return { name: trimmed, path };
  },
});
const fs = rootedFs({ roots: async () => (await projects.list()).map((p) => ({ id: p.id, path: p.path })) });

/** Demo: a record with a secret field, the shape a DB app uses for connections. */
export const demoSecrets = recordStore<{ token?: unknown }>({
  dir: appHome(APP.id),
  name: 'demoSecrets',
  secretFields: ['token'],
  secrets: secretStore(APP.id),
  validate: () => ({}),
});

export interface SavedRequest {
  name: string;
  request: HttpRequestDraft;
  /** Value of the Authorization header; kept in the secret store, never returned by a route. */
  auth?: unknown;
}


/** Saved REST requests; the Authorization value is a secret field. */
export const requests = recordStore<SavedRequest>({
  dir: appHome(APP.id),
  name: 'requests',
  secretFields: ['auth'],
  secrets: secretStore(APP.id),
  validate(input) {
    const { name, request } = isRecord(input) ? input : ({} as Record<string, unknown>);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 80) throw invalid('badRequestName', 'The name must have 1 to 80 characters.');
    return { name: trimmed, request: validateDraft(request) };
  },
});

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/** The saved Authorization value, only for the origin the request was saved with. */
const secretHeaders = async (ref: string, url: string): Promise<Array<[string, string]>> => {
  const saved = await requests.get(ref).catch((err: unknown) => {
    if (err instanceof AppError && err.kind === 'notfound') return null;
    throw err;
  });
  if (!saved || !sameOrigin(url, saved.request.url)) return [];
  const value = await requests.secret(ref, 'auth');
  return value ? [['Authorization', value]] : [];
};

const MAX_IMPORT_BYTES = 1_000_000;
const HTTP_FILE_FILTERS = [
  { name: 'HTTP', patterns: ['*.http', '*.rest'] },
  { name: 'All files', patterns: ['*.*'] },
];

const MAX_DEMO_ROWS = 100_000;
const DEMO_BATCH = 500;
const DEMO_PAUSE_MS = 20;
/** Paths the save dialog returned and `/api/demo/save` may still write once. */
const saveTargets = pickedPaths();

const target = async (json: <T>() => Promise<T>) => {
  const { root, path } = await json<{ root?: unknown; path?: unknown }>();
  return (await fs.resolve(String(root), typeof path === 'string' ? path : '', { mustExist: true })).real;
};

/**
 * This app's own endpoints. Keys are "METHOD /path"; handlers return a JSON-serializable value
 * or throw an AppError (`invalid`, `notFound`) that the UI shows translated as `error.<code>`.
 */
export const routes = (ctx: StartContext): Routes => ({
  ...recordRoutes(projects, '/api/projects'),
  ...fs.routes,
  ...dialogRoutes({ picked: pickedFolders }),
  ...editorRoutes({ dir: appHome(APP.id), fs }),
  'POST /api/fs/reveal': async ({ json }) => {
    await revealInFolder(await target(json)).catch(fromPlatform);
    return { ok: true };
  },
  'POST /api/fs/open': async ({ json }) => {
    await openWithDefault(await target(json)).catch(fromPlatform);
    return { ok: true };
  },
  'GET /api/demo/rows': ({ req, query }) => {
    const asked = Number(query.get('count') ?? 50_000);
    const count = Number.isInteger(asked) ? Math.min(Math.max(asked, 1), MAX_DEMO_ROWS) : 50_000;
    return ndjson(req, async (emit, signal) => {
      for (let id = 1; id <= count && !signal.aborted; id++) {
        await emit({ id, name: `Item ${id}`, amount: Math.round(((id * 7919) % 100_000) / 10) / 10, date: new Date(Date.UTC(2024, 0, 1) + (id % 730) * 86_400_000).toISOString().slice(0, 10) });
        if (id % DEMO_BATCH === 0) await Bun.sleep(DEMO_PAUSE_MS);
      }
    });
  },
  'POST /api/demo/save-target': async () => {
    const path = await saveFileAs({ suggestedName: 'rows.csv', filters: [{ name: 'CSV', patterns: ['*.csv'] }] }).catch(fromPlatform);
    if (path) saveTargets.add(path);
    return { path };
  },
  'POST /api/demo/save': async ({ json }) => {
    const { path, text } = await json<{ path?: unknown; text?: unknown }>();
    if (typeof path !== 'string' || typeof text !== 'string' || !saveTargets.take(path)) throw forbidden('notASaveTarget', 'Choose where to save first.');
    await writeFileAtomic(path, text).catch(fromPlatform);
    return { ok: true };
  },
  ...recordRoutes(demoSecrets, '/api/demo/secrets'),
  ...recordRoutes(requests, '/api/requests'),
  // The file's text goes to the client for parsing; its path never does.
  'POST /api/requests/import-file': async () => {
    const path = await pickFile({ filters: HTTP_FILE_FILTERS }).catch(fromPlatform);
    if (!path) return { text: null };
    const file = Bun.file(path);
    if (file.size > MAX_IMPORT_BYTES) throw invalid('importTooLarge', 'The file is too large to import.');
    return { name: basename(path), text: await file.text() };
  },
  ...httpRoutes(httpExecutor(), { secretHeaders }),
  // Example endpoint; delete it once real ones exist.
  'POST /api/echo': async ({ json }) => {
    const body = await json<{ text?: unknown }>();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw invalid('emptyText', 'Type something first.');
    return { text, length: text.length, at: new Date().toISOString() };
  },
  // Example notification: a click opens the app on the Settings screen.
  'POST /api/toast/test': () => {
    toaster.show({ title: APP.name, body: 'Click to open the Settings screen.', launch: ctx.link('settings') });
    return { ok: true };
  },
});
