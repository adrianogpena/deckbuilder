import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { appHome } from '@deckbuilder/platform';
import { invalid } from '@deckbuilder/server-core';
import { pickedPaths, recordStore } from '@deckbuilder/server-mods';
import { APP } from '../app.ts';

/** The app data folder; the stores shared by several views live here, owned by no view's routes. */
export const home = appHome(APP.id);

export const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Folders the folder dialog returned; a project path must be one of them (taken once). */
export const pickedFolders = pickedPaths();

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

/** The project folders as roots for the rooted file system and the Git routes. */
export const projectRoots = async () => (await projects.list()).map((p) => ({ id: p.id, path: p.path }));
