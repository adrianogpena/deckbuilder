import { fileIconOf, formatBytes, Icon, PanelBanner, t } from '@deckbuilderkit/ui';
import { useMemo, useState } from 'react';

/** What `/api/fs/archive` returns. */
export interface ArchiveContent {
  entries: { path: string; dir: boolean; size: number; mtime: number; encrypted: boolean }[];
  truncated: boolean;
}

interface Node {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  encrypted: boolean;
  children: Node[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function treeOf(entries: ArchiveContent['entries']): Node {
  const root: Node = { name: '', path: '', dir: true, size: 0, mtime: 0, encrypted: false, children: [] };
  const byPath = new Map<string, Node>([['', root]]);
  const folder = (path: string): Node => {
    const known = byPath.get(path);
    if (known) return known;
    const i = path.lastIndexOf('/');
    const node: Node = { name: path.slice(i + 1), path, dir: true, size: 0, mtime: 0, encrypted: false, children: [] };
    byPath.set(path, node);
    folder(i < 0 ? '' : path.slice(0, i)).children.push(node);
    return node;
  };
  for (const e of entries) {
    const path = e.path.replace(/^\.?\/+|\/+$/g, '');
    if (!path) continue;
    if (e.dir) {
      folder(path).mtime = e.mtime;
      continue;
    }
    const i = path.lastIndexOf('/');
    folder(i < 0 ? '' : path.slice(0, i)).children.push({ name: path.slice(i + 1), path, dir: false, size: e.size, mtime: e.mtime, encrypted: e.encrypted, children: [] });
  }
  const finish = (n: Node): number => {
    n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || collator.compare(a.name, b.name));
    if (n.dir) n.size = n.children.reduce((sum, c) => sum + finish(c), 0);
    return n.size;
  };
  finish(root);
  return root;
}

/** The files of an archive as a folder tree with sizes and dates, and a filter. */
export function ArchiveView({ archive }: { archive: ArchiveContent }) {
  const tree = useMemo(() => treeOf(archive.entries), [archive]);
  const files = useMemo(() => archive.entries.filter((e) => !e.dir), [archive]);
  const total = useMemo(() => files.reduce((sum, e) => sum + e.size, 0), [files]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.children.length === 1 && tree.children[0]!.dir ? [tree.children[0]!.path] : []));
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();

  const rows: { node: Node; depth: number }[] = [];
  const walk = (n: Node, depth: number) => {
    for (const c of n.children) {
      if (q) {
        if (c.dir) walk(c, depth);
        else if (c.path.toLowerCase().includes(q)) rows.push({ node: c, depth: 0 });
      } else {
        rows.push({ node: c, depth });
        if (c.dir && open.has(c.path)) walk(c, depth + 1);
      }
    }
  };
  walk(tree, 0);

  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div className="file-preview">
      {archive.truncated && <PanelBanner tone="warn" icon="alert">{t('archive.truncated')}</PanelBanner>}
      <div className="file-preview-bar archive-bar">
        <span className="archive-summary">{t('archive.summary', { count: files.length, size: formatBytes(total) })}</span>
        <input className="input archive-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('archive.filter')} aria-label={t('archive.filter')} />
      </div>
      <div className="file-preview-body archive-body">
        {rows.length === 0 && <div className="archive-empty">{t('archive.empty')}</div>}
        {rows.map(({ node, depth }) => (
          <div
            key={node.path}
            className={`archive-row${node.dir ? ' archive-dir' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={node.dir && !q ? () => toggle(node.path) : undefined}
          >
            <span className="archive-name" title={node.path}>
              <Icon name={node.dir ? 'folder' : fileIconOf(node.name).icon} size={14} />
              <span>{q ? node.path : node.name}</span>
              {node.encrypted && <span title={t('archive.encrypted')}>🔒</span>}
            </span>
            <span className="archive-size">{formatBytes(node.size)}</span>
            <span className="archive-date">{node.mtime ? new Date(node.mtime).toLocaleString() : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
