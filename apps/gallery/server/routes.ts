import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { appHome, createToaster, openWithDefault, revealInFolder } from '@deckbuilder/platform';
import { invalid, type Routes } from '@deckbuilder/server-core';
import { dialogRoutes, fromPlatform, recordRoutes, recordStore, rootedFs } from '@deckbuilder/server-mods';
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

/** The folders the Explorer screen shows; each is a root of the rooted file system. */
const projects = recordStore<{ name: string; path: string }>({
  dir: appHome(APP.id),
  name: 'projects',
  validate(input) {
    const { name, path } = (input ?? {}) as { name?: unknown; path?: unknown };
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 80) throw invalid('badProjectName', 'The name must have 1 to 80 characters.');
    if (typeof path !== 'string' || !isAbsolute(path) || !isDirectory(path)) throw invalid('badProjectPath', 'The path must be an existing folder.');
    return { name: trimmed, path };
  },
});
const fs = rootedFs({ roots: async () => (await projects.list()).map((p) => ({ id: p.id, path: p.path })) });

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
  ...dialogRoutes(),
  'POST /api/fs/reveal': async ({ json }) => {
    await revealInFolder(await target(json)).catch(fromPlatform);
    return { ok: true };
  },
  'POST /api/fs/open': async ({ json }) => {
    await openWithDefault(await target(json)).catch(fromPlatform);
    return { ok: true };
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
    toaster.show({ title: APP.name, body: 'Click to open the Settings screen.', launch: ctx.link('settings') });
    return { ok: true };
  },
});
