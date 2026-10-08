import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  type ApiError,
  ContextMenu,
  type ContextMenuItem,
  errorOf,
  ErrorBanner,
  Icon,
  Spinner,
  TreeView,
  type TreeViewHandle,
  useDialogs,
  useStream,
} from '@deckbuilder/ui';
import { api, type FsEntry, type Project, type SearchHit } from '../../api';
import { dirname, isUnder, joinPath, nodeId } from '../../explorer-paths';
import { t } from '../../i18n';

const MAX_HITS = 500;

interface Node {
  project: string;
  path: string;
  name: string;
  kind: FsEntry['kind'];
  outside?: boolean;
}

const isRoot = (node: Node) => node.path === '';

export interface ProjectTreeProps {
  project: Project;
  expanded: string[];
  onExpandedChange(ids: string[]): void;
  onOpenFile(project: string, path: string): void;
  /** A file or folder was renamed or moved. */
  onMoved(project: string, from: string, to: string): void;
  onDeleted(project: string, path: string): void;
  onClose(): void;
}

/** One project of the sidebar: a search box and the lazy tree of its folder, with the file actions. */
export function ProjectTree({ project, expanded, onExpandedChange, onOpenFile, onMoved, onDeleted, onClose }: ProjectTreeProps) {
  const tree = useRef<TreeViewHandle>(null);
  const { confirm, prompt, element } = useDialogs();
  const [error, setError] = useState<ApiError>();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; node: Node }>();
  const [query, setQuery] = useState('');
  const [content, setContent] = useState(false);
  const [searched, setSearched] = useState(false);
  const search = useStream<SearchHit>({ maxItems: MAX_HITS });

  const roots = useMemo<Node[]>(() => [{ project: project.id, path: '', name: project.name, kind: 'dir' }], [project.id, project.name]);

  const run = async (job: () => Promise<void>) => {
    setError(undefined);
    try {
      await job();
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const expand = (id: string) => {
    if (!expanded.includes(id)) onExpandedChange([...expanded, id]);
  };

  const loadChildren = async (node: Node): Promise<Node[]> =>
    (await api.fsList(project.id, node.path)).map((e) => ({
      project: project.id,
      path: joinPath(node.path, e.name),
      name: e.name,
      kind: e.kind,
      outside: e.outside,
    }));

  const reloadDir = (path: string) => tree.current?.reload(nodeId(project.id, path));

  const open = (node: Node) => {
    if (node.outside) return;
    if (node.kind === 'dir') {
      const id = nodeId(project.id, node.path);
      onExpandedChange(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]);
    } else {
      onOpenFile(project.id, node.path);
    }
  };

  const create = (kind: 'file' | 'dir', node: Node) =>
    run(async () => {
      const dir = node.kind === 'dir' ? node.path : dirname(node.path);
      const name = await prompt({
        title: t(kind === 'file' ? 'explorer.newFile' : 'explorer.newFolder'),
        label: t('explorer.name'),
        validate: (value) => (!value.trim() ? '' : /[\\/]/.test(value) ? t('explorer.nameInvalid') : null),
      });
      if (!name?.trim()) return;
      const path = joinPath(dir, name.trim());
      try {
        await api.fsCreate(project.id, path, kind);
      } finally {
        reloadDir(dir);
      }
      expand(nodeId(project.id, dir));
      if (kind === 'file') onOpenFile(project.id, path);
    });

  const rename = (node: Node, name: string) =>
    run(async () => {
      if (isRoot(node) || node.outside) return;
      await api.fsRename(project.id, node.path, name);
      onMoved(project.id, node.path, joinPath(dirname(node.path), name));
      reloadDir(dirname(node.path));
    });

  const remove = (node: Node) =>
    run(async () => {
      if (isRoot(node) || node.outside) return;
      const ok = await confirm({
        title: t('explorer.deleteTitle'),
        body: t('explorer.deleteBody', { name: node.name }),
        okLabel: t('explorer.delete'),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.fsDelete(project.id, [node.path]);
        onDeleted(project.id, node.path);
      } finally {
        reloadDir(dirname(node.path));
      }
    });

  const move = (dragged: Node, target: Node) =>
    run(async () => {
      if (isRoot(dragged) || dragged.outside || target.outside || dirname(dragged.path) === target.path || isUnder(target.path, dragged.path)) return;
      const to = joinPath(target.path, dragged.name);
      try {
        await api.fsMove(project.id, dragged.path, to);
        onMoved(project.id, dragged.path, to);
      } finally {
        reloadDir(dirname(dragged.path));
        reloadDir(target.path);
      }
    });

  const menuItems = (node: Node): Array<ContextMenuItem | 'sep'> => {
    const disabled = !!node.outside;
    const item = (id: string, label: string, act: () => void, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({ id, label, run: act, disabled, ...extra });
    const call = (job: () => Promise<unknown>) => () => void run(async () => void (await job()));
    return [
      ...(node.kind === 'dir' ? [] : [item('open', t('explorer.open'), () => open(node), { icon: 'file' })]),
      item('newFile', t('explorer.newFile'), () => void create('file', node), { icon: 'plus' }),
      item('newDir', t('explorer.newFolder'), () => void create('dir', node), { icon: 'folder' }),
      'sep',
      ...(isRoot(node)
        ? []
        : [
            item('rename', t('explorer.rename'), () => tree.current?.startRename(nodeId(project.id, node.path)), { icon: 'edit', hint: 'F2' }),
            item('delete', t('explorer.delete'), () => void remove(node), { icon: 'trash', hint: 'Del', danger: true }),
            'sep' as const,
          ]),
      item('reveal', t('explorer.reveal'), call(() => api.fsReveal(project.id, node.path))),
      ...(node.kind === 'dir' ? [] : [item('openDefault', t('explorer.openDefault'), call(() => api.fsOpen(project.id, node.path)))]),
    ];
  };

  const startSearch = (q: string, withContent: boolean) => {
    if (!q.trim()) return;
    setSearched(true);
    search.start('/api/fs/search', { root: project.id, path: '', q: q.trim(), content: withContent ? '1' : undefined });
  };

  const clearSearch = () => {
    search.cancel();
    setSearched(false);
    setQuery('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) startSearch(query, content);
    else clearSearch();
  };

  const toggleContent = () => {
    setContent(!content);
    if (searched) startSearch(query, !content);
  };

  return (
    <section className="xp-project">
      {element}
      <div className="xp-head">
        <form className="xp-search" onSubmit={submit}>
          <input
            type="search"
            value={query}
            placeholder={t('explorer.search.placeholder', { name: project.name })}
            aria-label={t('explorer.search.placeholder', { name: project.name })}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              if (search.running) search.cancel();
              else clearSearch();
            }}
          />
        </form>
        <button type="button" className={`chip${content ? ' chip-on' : ''}`} onClick={toggleContent} aria-pressed={content}>
          {t('explorer.search.content')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title={t('explorer.closeProject')} aria-label={t('explorer.closeProject')}>
          <Icon name="close" />
        </button>
      </div>
      {error && (
        <div className="xp-error">
          <ErrorBanner error={error} compact />
        </div>
      )}
      {searched && (
        <div className="xp-results">
          <div className="xp-status muted">
            {search.running ? (
              <>
                <Spinner small /> {t('explorer.search.running')}
              </>
            ) : search.items.length === 0 && !search.error ? (
              t('explorer.search.none')
            ) : (
              t('explorer.search.count', { count: search.items.length })
            )}
            {search.truncated && ` · ${t('explorer.search.truncated', { count: MAX_HITS })}`}
          </div>
          {search.error && <ErrorBanner error={search.error} compact />}
          {search.items.map((hit, i) => (
            <button
              key={`${hit.path}:${hit.line ?? ''}:${i}`}
              className="xp-hit"
              disabled={hit.kind === 'dir'}
              onClick={() => onOpenFile(project.id, hit.path)}
              title={hit.path}
            >
              <Icon name={hit.kind === 'dir' ? 'folder' : 'file'} size={14} />
              <span className="xp-hit-text">
                <span className="xp-hit-path">
                  {hit.path}
                  {hit.line ? `:${hit.line}` : ''}
                </span>
                {hit.text && <span className="xp-hit-line mono">{hit.text}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <div hidden={searched}>
        <TreeView
          ref={tree}
          roots={roots}
          idOf={(n) => nodeId(n.project, n.path)}
          labelOf={(n) => (n.outside ? `${n.name} (${t('explorer.outside')})` : n.name)}
          iconOf={(n) => (n.kind === 'dir' ? 'folder' : 'file')}
          hasChildren={(n) => n.kind === 'dir'}
          loadChildren={loadChildren}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          onOpen={open}
          onContextMenu={(node, e) => setMenu({ at: { x: e.clientX, y: e.clientY }, node })}
          onRename={(node, name) => void rename(node, name)}
          onDelete={(node) => void remove(node)}
          draggable
          onDrop={(dragged, target) => void move(dragged, target)}
        />
      </div>
      {menu && <ContextMenu at={menu.at} items={menuItems(menu.node)} onClose={() => setMenu(undefined)} />}
    </section>
  );
}
