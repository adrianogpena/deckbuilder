import type { GitFile } from '@deckbuilderkit/server-core/protocol';

export interface ChangeFolder {
  /** Shown name; `a/b` when a folder holds only one folder. */
  name: string;
  /** Path from the repository root of the deepest folder of the row; '' for the root. */
  path: string;
  folders: ChangeFolder[];
  files: GitFile[];
}

interface Node {
  name: string;
  path: string;
  folders: Map<string, Node>;
  files: GitFile[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Changed files nested under their folders, folders first, each sorted by name; single-child folder chains share a row. */
export function changeTree(files: GitFile[]): ChangeFolder {
  const root: Node = { name: '', path: '', folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop();
    let at = root;
    for (const part of parts) {
      let next = at.folders.get(part);
      if (!next) {
        next = { name: part, path: at.path ? `${at.path}/${part}` : part, folders: new Map(), files: [] };
        at.folders.set(part, next);
      }
      at = next;
    }
    at.files.push(file);
  }
  const finish = (start: Node): ChangeFolder => {
    let node = start;
    let name = start.name;
    while (node !== root && node.files.length === 0 && node.folders.size === 1) {
      node = [...node.folders.values()][0]!;
      name = `${name}/${node.name}`;
    }
    return {
      name,
      path: node.path,
      folders: [...node.folders.values()].map(finish).sort((a, b) => byName(a.name, b.name)),
      files: [...node.files].sort((a, b) => byName(baseName(a.path), baseName(b.path))),
    };
  };
  return finish(root);
}

/** Paths of every folder row under `folder`. */
export function folderPaths(folder: ChangeFolder): string[] {
  return folder.folders.flatMap((f) => [f.path, ...folderPaths(f)]);
}
