import { relPath } from '@deckbuilder/ui';
import type { FsArchiveFormat } from '@deckbuilder/server-core/protocol';
import { explorerApi as api } from '../client';
import { t } from '../i18n';
import { freeName } from './os-drop';

/** File actions shared by the project tree and the details tab. */

/** The archive name without its extension(s): `a.tar.gz` → `a`. */
export const archiveStem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/\.tar$/i, '') || name;

/** The folder all `items` sit in, or undefined when they span folders (or there are none). */
export const commonParent = (items: ReadonlyArray<{ path: string }>) => {
  const parents = new Set(items.map((n) => relPath.dirname(n.path)));
  return parents.size === 1 ? [...parents][0]! : undefined;
};

/** Names in `dir` of `project`, folded the way the OS compares them, and the fold. */
export const takenIn = async (project: string, dir: string) => {
  const fold = /Windows|Mac/.test(navigator.userAgent) ? (n: string) => n.toLowerCase() : (n: string) => n;
  return { fold, taken: new Set((await api.fsList(project, dir)).map((e) => fold(e.name))) };
};

/** Compresses `paths` (all in one folder) into a free name next to them; undefined when they span folders. */
export async function compressPaths(project: { id: string; name: string }, paths: string[], format: FsArchiveFormat) {
  const dir = commonParent(paths.map((path) => ({ path })));
  if (dir === undefined || paths.length === 0) return undefined;
  const { fold, taken } = await takenIn(project.id, dir);
  const base = paths.length === 1 ? relPath.basename(paths[0]!) : relPath.basename(dir) || project.name;
  const name = freeName(`${base}.${format}`, false, taken, fold);
  const result = await api.fsCompress(project.id, paths, name, format);
  const skipped = result.skippedLinks.length;
  return { dir, name, result, message: skipped ? t('explorer.compressedSkipped', { name, count: skipped }) : t('explorer.compressed', { name }) };
}
