import { useState } from 'react';
import { ErrorBanner, Icon, PanelLoading, useAsync } from '@deckbuilderkit/ui';
import type { PanelModule, PanelProps } from '../../workspace/types';
import { type FsEntry, fs, joinPath } from './fs';
import './style.css';

function Dir({ root, path, depth, onOpen }: { root: string; path: string; depth: number; onOpen(path: string, alt: boolean): void }) {
  const list = useAsync(() => fs.list(root, path), [root, path]);
  if (list.loading && !list.data) return <PanelLoading />;
  if (list.error) return <ErrorBanner error={list.error} />;
  return (
    <>
      {(list.data ?? []).map((e) => (
        <Node key={e.name} root={root} entry={e} path={joinPath(path, e.name)} depth={depth} onOpen={onOpen} />
      ))}
    </>
  );
}

function Node({ root, entry, path, depth, onOpen }: { root: string; entry: FsEntry; path: string; depth: number; onOpen(path: string, alt: boolean): void }) {
  const [open, setOpen] = useState(false);
  const dir = entry.kind === 'dir' || entry.target === 'dir';
  return (
    <>
      <button
        type="button"
        className="agents-files-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e) => (dir ? setOpen(!open) : onOpen(path, e.altKey))}
      >
        <Icon name={dir ? (open ? 'chevron-down' : 'chevron') : 'file'} />
        <span className="agents-files-name">{entry.name}</span>
      </button>
      {dir && open && <Dir root={root} path={path} depth={depth + 1} onOpen={onOpen} />}
    </>
  );
}

/** The project's file tree; a click opens the file in a code tab, Alt+click in a preview. */
export function FileTree({ project, open }: { project: string; open(path: string, kind: 'code' | 'preview'): void }) {
  return (
    <div className="agents-files-tree" role="tree">
      <Dir root={project} path="" depth={0} onOpen={(p, alt) => open(p, alt ? 'preview' : 'code')} />
    </div>
  );
}

function FilesPanel({ project, api }: PanelProps) {
  return (
    <div className="agents-panel-files">
      <FileTree project={project} open={(path, kind) => api.open(kind, { path })} />
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'files',
  titleKey: 'panel.files.title',
  icon: 'folder',
  placement: 'both',
  single: true,
  Panel: FilesPanel,
};
