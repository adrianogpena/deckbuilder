import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { appHome, createToaster, openWithDefault, pickFile, revealInFolder, saveFileAs, secretStore, writeFileAtomic } from '@deckbuilder/platform';
import type { HttpRequestDraft } from '@deckbuilder/editor/http';
import { dbRoutes, dbSessions, parseOracleUrl, sqlHistory, validConnection, type DbConnectionFields } from '@deckbuilder/db';
import { AppError, forbidden, invalid, isRecord, ndjson, notFound, type Routes } from '@deckbuilder/server-core';
import { REST_ENV_MAX_VARS, REST_ENV_NAME_CHARS, REST_VAR_NAME, type RestEnvVar } from '@deckbuilder/server-core/protocol';
import { dialogRoutes, editorRoutes, fromPlatform, httpExecutor, gitRoutes, httpRoutes, pickedPaths, recordRoutes, recordStore, restHistory, restTabsRoutes, rootedFs, validateDraft } from '@deckbuilder/server-mods';
import type { StartContext } from '@deckbuilder/shell';
import { APP, MULTI_DELETE_ENABLED } from '../app.ts';

const toaster = createToaster();
const home = appHome(APP.id);
const osSecrets = secretStore(APP.id);

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
  dir: home,
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
const projectRoots = async () => (await projects.list()).map((p) => ({ id: p.id, path: p.path }));
const fs = rootedFs({ multiDelete: MULTI_DELETE_ENABLED, roots: projectRoots });

/** The file download behind dragging a file out of the tree; its link carries a one-time ticket, not the session token. */
export const openRoutes = fs.openRoutes;

/** A project folder as a terminal's working directory: `path` inside project `root`, a directory. */
export async function resolveCwd(root: string, path: string): Promise<string> {
  const { real } = await fs.resolve(root, path, { mustExist: true });
  if (!isDirectory(real)) throw invalid('notADirectory', 'The path is not a folder.');
  return real;
}

/** Oracle connections of the Workbench; the password is a secret field, never returned by a route. */
export const dbConnections = recordStore<DbConnectionFields & { password?: unknown }>({
  dir: home,
  name: 'dbConnections',
  secretFields: ['password'],
  secrets: osSecrets,
  validate: (input) => validConnection(input),
});
const sessions = dbSessions();
const scriptFile = (id: string) => join(home, 'workbench', `${id}.sql`);
/** Statements the Workbench and the Explorer ran; main.ts sets its size from `workbench.historySize`. */
export const sqlHistoryStore = sqlHistory({ dir: home, max: 500 });
const dbApi = dbRoutes({
  sessions,
  history: sqlHistoryStore,
  scripts: {
    read: (id) => readFile(scriptFile(id), 'utf8').catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? '' : Promise.reject(err))),
    write: (id, text) => writeFileAtomic(scriptFile(id), text),
  },
  async credentials(id) {
    const record = await dbConnections.get(id).catch((err: unknown) => {
      if (err instanceof AppError && err.kind === 'notfound') return null;
      throw err;
    });
    if (!record) return null;
    return {
      connectString: parseOracleUrl(record.url).connectString,
      user: record.user,
      password: (await dbConnections.secret(id, 'password')) ?? '',
    };
  },
});
const connectionRoutes = recordRoutes(dbConnections, '/api/db/connections');

export interface SavedRequest {
  name: string;
  request: HttpRequestDraft;
  /** Value of the Authorization header; kept in the secret store, never returned by a route. */
  auth?: unknown;
}

/** Saved REST requests; the Authorization value is a secret field. */
export const requests = recordStore<SavedRequest>({
  dir: home,
  name: 'requests',
  secretFields: ['auth'],
  secrets: osSecrets,
  validate(input) {
    const { name, request } = isRecord(input) ? input : ({} as Record<string, unknown>);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 80) throw invalid('badRequestName', 'The name must have 1 to 80 characters.');
    return { name: trimmed, request: validateDraft(request) };
  },
});

/** Sent REST requests; main.ts sets its size from `rest.historySize`. */
export const restHistoryStore = restHistory({ dir: home, max: 100 });

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/**
 * The saved Authorization value, only for the origin the request was saved with. Both URLs are
 * compared resolved (the saved one with the same environment): the check is against the URL sent.
 */
const secretHeaders = async (ref: string, url: string, resolve: (text: string) => string): Promise<Array<[string, string]>> => {
  const saved = await requests.get(ref).catch((err: unknown) => {
    if (err instanceof AppError && err.kind === 'notfound') return null;
    throw err;
  });
  if (!saved || !sameOrigin(url, resolve(saved.request.url))) return [];
  const value = await requests.secret(ref, 'auth');
  return value ? [['Authorization', value]] : [];
};

interface StoredEnvironment {
  name: string;
  /** A secret variable's value is `''` here; `set` tells whether `secrets` holds one. */
  vars: RestEnvVar[];
  /** JSON object name → value of the secret variables; a secret field. */
  secrets?: unknown;
}

const MAX_VAR_VALUE_CHARS = 8192;
const badEnvironment = () => invalid('badEnvironment', 'The environment is not valid.');

/** REST environments for `{{name}}`; secret values live in the secret store, the client sees only `set`. */
export const environments = recordStore<StoredEnvironment>({
  dir: home,
  name: 'environments',
  secretFields: ['secrets'],
  secrets: osSecrets,
  validate(input, prev, ctx) {
    const { name, vars } = isRecord(input) ? input : ({} as Record<string, unknown>);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > REST_ENV_NAME_CHARS) throw invalid('badEnvironmentName', 'The name must have 1 to 80 characters.');
    if (!Array.isArray(vars) || vars.length > REST_ENV_MAX_VARS) throw badEnvironment();
    const names = new Set<string>();
    const out = vars.map((v): RestEnvVar => {
      if (!isRecord(v) || typeof v.name !== 'string' || typeof v.value !== 'string' || typeof v.secret !== 'boolean') throw badEnvironment();
      if (!REST_VAR_NAME.test(v.name)) throw invalid('badVariableName', 'A variable name may have letters, digits, _ . and -, and starts with a letter or _.');
      if (names.has(v.name)) throw invalid('duplicateVariable', 'Two variables have the same name.');
      names.add(v.name);
      const enabled = v.enabled !== false;
      if (!v.secret) {
        if (v.value.length > MAX_VAR_VALUE_CHARS) throw badEnvironment();
        return { name: v.name, value: v.value, secret: false, enabled };
      }
      // An import never carries secrets: a variable is set only when the stored record had it set.
      const set = ctx?.imported ? Boolean(prev?.vars.find((p) => p.name === v.name && p.secret)?.set) : v.set === true;
      return { name: v.name, value: '', secret: true, enabled, set };
    });
    return { name: trimmed, vars: out };
  },
});

const storedSecrets = async (id: string): Promise<Map<string, string>> => {
  const raw = await environments.secret(id, 'secrets');
  if (!raw) return new Map();
  const parsed: unknown = JSON.parse(raw);
  return new Map(isRecord(parsed) ? Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string') : []);
};

/**
 * Client input as the store takes it: a secret variable with a string `value` sets or replaces it
 * (`''` clears it), without one it keeps the stored value of `from` (old name) or its own name.
 */
async function environmentInput(raw: unknown, id?: string): Promise<unknown> {
  if (!isRecord(raw) || !Array.isArray(raw.vars) || raw.vars.length > REST_ENV_MAX_VARS) throw badEnvironment();
  const old = id ? await storedSecrets(id) : new Map<string, string>();
  const secrets: Record<string, string> = {};
  const vars = raw.vars.map((v) => {
    if (!isRecord(v) || v.secret !== true || typeof v.name !== 'string') return v;
    const value = typeof v.value === 'string' ? v.value : (old.get(typeof v.from === 'string' ? v.from : v.name) ?? '');
    if (value.length > MAX_VAR_VALUE_CHARS) throw badEnvironment();
    if (value !== '') secrets[v.name] = value;
    return { name: v.name, value: '', secret: true, enabled: v.enabled, set: value !== '' };
  });
  return { name: raw.name, vars, secrets: Object.keys(secrets).length ? JSON.stringify(secrets) : '' };
}

/** The enabled variables of environment `id`, secrets included; a secret without a value is left out (unknown). */
const environmentVars = async (id: string): Promise<Record<string, string>> => {
  const env = await environments.get(id).catch((err: unknown) => {
    if (err instanceof AppError && err.kind === 'notfound') throw notFound('environmentNotFound', 'The environment no longer exists.');
    throw err;
  });
  const secrets = env.vars.some((v) => v.secret && v.enabled) ? await storedSecrets(id) : new Map<string, string>();
  const vars: Record<string, string> = {};
  for (const v of env.vars) {
    if (!v.enabled) continue;
    const value = v.secret ? secrets.get(v.name) : v.value;
    if (value !== undefined) vars[v.name] = value;
  }
  return vars;
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
  ...editorRoutes({ dir: home, fs }),
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
  'POST /api/demo/save-target': async ({ json }) => {
    const { format } = await json<{ format?: unknown }>().catch(() => ({ format: undefined }));
    const ext = format === 'json' ? 'json' : 'csv';
    const path = await saveFileAs({ suggestedName: `rows.${ext}`, filters: [{ name: ext.toUpperCase(), patterns: [`*.${ext}`] }] }).catch(fromPlatform);
    if (path) saveTargets.add(path);
    return { path };
  },
  'POST /api/demo/save': async ({ json }) => {
    const { path, text } = await json<{ path?: unknown; text?: unknown }>();
    if (typeof path !== 'string' || typeof text !== 'string' || !saveTargets.take(path)) throw forbidden('notASaveTarget', 'Choose where to save first.');
    await writeFileAtomic(path, text).catch(fromPlatform);
    return { ok: true };
  },
  ...connectionRoutes,
  // A deleted record's open session is rolled back and closed.
  'DELETE /api/db/connections': async (rc) => {
    const id = rc.query.get('id');
    const result = await connectionRoutes['DELETE /api/db/connections']!(rc);
    if (id) await sessions.close(id);
    return result;
  },
  ...dbApi,
  ...recordRoutes(requests, '/api/requests'),
  // The saved Authorization value, only for Copy as curl.
  'GET /api/requests/auth': async ({ query }) => {
    const id = query.get('id');
    if (!id) throw invalid('badRequest', 'Invalid request.');
    await requests.get(id);
    return { value: (await requests.secret(id, 'auth')) ?? null };
  },
  ...restTabsRoutes({ dir: home }),
  ...gitRoutes({ roots: projectRoots }),
  // The target comes from the save dialog on this side; the client never names a path.
  'POST /api/requests/save-curl': async ({ json }) => {
    const { text } = await json<{ text?: unknown }>();
    if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) throw invalid('badRequest', 'Invalid request.');
    const path = await saveFileAs({ suggestedName: 'request.curl', filters: [{ name: 'cURL', patterns: ['*.curl', '*.sh'] }, { name: 'All files', patterns: ['*.*'] }] }).catch(fromPlatform);
    if (!path) return { path: null };
    await writeFileAtomic(path, `${text}\n`).catch(fromPlatform);
    return { path };
  },
  // The file's text goes to the client for parsing; its path never does.
  'POST /api/requests/import-file': async () => {
    const path = await pickFile({ filters: HTTP_FILE_FILTERS }).catch(fromPlatform);
    if (!path) return { text: null };
    const file = Bun.file(path);
    if (file.size > MAX_IMPORT_BYTES) throw invalid('importTooLarge', 'The file is too large to import.');
    return { name: basename(path), text: await file.text() };
  },
  ...httpRoutes(httpExecutor(), { secretHeaders, environmentVars, onSend: (entry) => restHistoryStore.append(entry) }),
  'GET /api/rest/history': async ({ query }) => restHistoryStore.list({ q: query.get('q') ?? undefined }),
  'DELETE /api/rest/history': async () => {
    await restHistoryStore.clear();
    return {};
  },
  ...recordRoutes(environments, '/api/rest/environments'),
  'POST /api/rest/environments': async ({ json }) => environments.create(await environmentInput(await json())),
  'PUT /api/rest/environments': async ({ query, json }) => {
    const id = query.get('id');
    if (!id) throw invalid('badRequest', 'Invalid request.');
    return environments.update(id, await environmentInput(await json(), id));
  },
  // Example endpoint; delete it once real ones exist.
  'POST /api/echo': async ({ json }) => {
    const body = await json<{ text?: unknown }>();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw invalid('emptyText', 'Type something first.');
    return { text, length: text.length, at: new Date().toISOString() };
  },
  // Example notification: a click opens the app on the Settings screen.
  'POST /api/toast/test': () => {
    toaster.show({ title: APP.name, body: 'Click to open the Settings.', launch: ctx.link('settings') });
    return { ok: true };
  },
});
