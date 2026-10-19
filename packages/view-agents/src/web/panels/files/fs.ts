import { request } from '@deckbuilderkit/ui';

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  size: number;
  mtime: number;
  target?: 'file' | 'dir';
}

export type FsRead = { text: string; size: number; mtime: number; truncated: boolean; readOnly?: true } | { binary: true; size: number; mtime: number };

export interface EditorInfo {
  id: string;
  name: string;
  path: string | null;
}

/** The server's file routes the Files, Code and Preview panels use. */
export const fs = {
  list: (root: string, path: string) => request<{ entries: FsEntry[] }>('GET', '/api/agents/fs/list', { root, path }).then((r) => r.entries),
  read: (root: string, path: string) => request<FsRead>('GET', '/api/agents/fs/read', { root, path }),
  stat: (root: string, path: string) => request<FsEntry>('GET', '/api/agents/fs/stat', { root, path }),
  write: (root: string, path: string, text: string, expectedMtime?: number) =>
    request<FsEntry>('POST', '/api/agents/fs/write', {}, { root, path, text, expectedMtime }),
  editors: () => request<EditorInfo[]>('GET', '/api/agents/editors'),
  openInEditor: (editor: string, root: string, path: string) => request<{ ok: true }>('POST', '/api/agents/editors/open', {}, { editor, root, path }),
};

export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** A path from the tab params, made relative to the project root with `/` separators; undefined when it is outside. */
export function relativeTo(root: string, path: string): string | undefined {
  const norm = (p: string) => p.split('\\').join('/').replace(/\/+$/, '');
  const r = norm(root);
  const p = norm(path);
  if (/^([a-zA-Z]:)?\//.test(p)) {
    const lower = (s: string) => s.toLowerCase();
    return lower(p).startsWith(`${lower(r)}/`) ? p.slice(r.length + 1) : undefined;
  }
  return p.replace(/^\.\//, '');
}
