import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import {
  ContextMenu,
  type ContextMenuItem,
  errorMessage,
  errorOf,
  fileIconOf,
  folderIconOf,
  relPath,
  TreeView,
  type TreeViewHandle,
  useAsync,
  useDialogs,
  useToast,
} from '@deckbuilder/ui';
import { api, type FsEntry, type Project } from '../../api';
import { fullPath, nodeId } from '../../explorer-paths';
import { t } from '../../i18n';
import { useCopyPath } from './copy-path';

interface Node {
  project: string;
  path: string;
  name: string;
  kind: FsEntry['kind'];
  outside?: boolean;
  target?: FsEntry['target'];
}

const isRoot = (node: Node) => node.path === '';
const isDir = (node: Node) => node.kind === 'dir' || node.target === 'dir';

export interface ProjectTreeProps {
  project: Project;
  expanded: string[];
  onExpandedChange(ids: string[]): void;
  onOpenFile(project: string, path: string): void;
  /** A single click on a file; absent: a click only selects. */
  onPreviewFile?(project: string, path: string): void;
  /** Absent: no Open to the Side. */
  onOpenFileToSide?(project: string, path: string): void;
  onOpenTerminal(project: string, path: string): void;
  /** A file or folder was renamed or moved. */
  onMoved(project: string, from: string, to: string): void;
  onDeleted(project: string, path: string): void;
  apiRef?: Ref<ProjectTreeApi>;
}

/** What the sidebar header and the commands can ask of a tree. */
export interface ProjectTreeApi {
  newFile(): void;
  newFolder(): void;
  refresh(): void;
  collapseAll(): void;
  /** Expands the folders above `path` and selects it. */
  reveal(path: string): void;
}

/** The lazy tree of a project's folder, with the file actions. */
export function ProjectTree({ project, expanded, onExpandedChange, onOpenFile, onPreviewFile, onOpenFileToSide, onOpenTerminal, onMoved, onDeleted, apiRef }: ProjectTreeProps) {
  const tree = useRef<TreeViewHandle<Node>>(null);
  const clipboard = useRef<{ mode: 'copy' | 'cut'; paths: string[] }>();
  const { confirm, prompt, element } = useDialogs();
  const toast = useToast();
  const copyPath = useCopyPath();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; node: Node; selection: Node[] }>();
  const editors = useAsync(() => api.editors(), []);

  const folderFiles = useRef(new Map<string, string[]>());

  const roots = useMemo<Node[]>(() => [{ project: project.id, path: '', name: project.name, kind: 'dir' }], [project.id, project.name]);

  const run = async (job: () => Promise<void>) => {
    try {
      await job();
    } catch (err) {
      toast({ message: errorMessage(errorOf(err)), kind: 'error' });
    }
  };

  const expand = (id: string) => {
    if (!expanded.includes(id)) onExpandedChange([...expanded, id]);
  };

  const loadChildren = async (node: Node): Promise<Node[]> => {
    const entries = await api.fsList(project.id, node.path);
    folderFiles.current.set(
      nodeId(project.id, node.path),
      entries.filter((e) => e.kind !== 'dir' && e.target !== 'dir').map((e) => e.name),
    );
    return entries.map((e) => ({
      project: project.id,
      path: relPath.join(node.path, e.name),
      name: e.name,
      kind: e.kind,
      outside: e.outside,
      target: e.target,
    }));
  };

  const iconOf = (n: Node) => {
    if (!isDir(n)) return fileIconOf(n.name).icon;
    return n.kind === 'link' ? 'folder-link' : folderIconOf(n.name, folderFiles.current.get(nodeId(project.id, n.path)));
  };

  const reloadDir = (path: string) => {
    folderFiles.current.delete(nodeId(project.id, path));
    tree.current?.reload(nodeId(project.id, path));
  };

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      folderFiles.current.clear();
      tree.current?.reload();
    };
    const timer = setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [project.id]);

  const rootNode = roots[0]!;
  const reveal = (path: string) => {
    const missing: string[] = [];
    for (let dir = relPath.dirname(path); ; dir = relPath.dirname(dir)) {
      const id = nodeId(project.id, dir);
      if (!expanded.includes(id)) missing.push(id);
      if (dir === '') break;
    }
    if (missing.length) onExpandedChange([...expanded, ...missing]);
    tree.current?.reveal(nodeId(project.id, path));
  };

  const open = (node: Node) => {
    if (node.outside) return;
    if (isDir(node)) {
      const id = nodeId(project.id, node.path);
      onExpandedChange(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]);
    } else {
      onOpenFile(project.id, node.path);
    }
  };

  const create = (kind: 'file' | 'dir', node: Node) =>
    run(async () => {
      const dir = isDir(node) ? node.path : relPath.dirname(node.path);
      const name = await prompt({
        title: t(kind === 'file' ? 'explorer.newFile' : 'explorer.newFolder'),
        label: t('explorer.name'),
        validate: (value) => (!value.trim() ? '' : /[\\/]/.test(value) ? t('explorer.nameInvalid') : null),
      });
      if (!name?.trim()) return;
      const path = relPath.join(dir, name.trim());
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
      onMoved(project.id, node.path, relPath.join(relPath.dirname(node.path), name));
      reloadDir(relPath.dirname(node.path));
    });

  const actionable = (nodes: Node[]) => nodes.filter((n) => !isRoot(n) && !n.outside);

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
        reloadDir(relPath.dirname(node.path));
      }
    });

  const move = (dragged: Node[], target: Node) =>
    run(async () => {
      if (target.outside) return;
      const moving = actionable(dragged).filter((n) => relPath.dirname(n.path) !== target.path && !relPath.isUnder(target.path, n.path));
      try {
        for (const n of moving) {
          const to = relPath.join(target.path, n.name);
          await api.fsMove(project.id, n.path, to);
          onMoved(project.id, n.path, to);
        }
      } finally {
        for (const dir of new Set(moving.map((n) => relPath.dirname(n.path)))) reloadDir(dir);
        if (moving.length) reloadDir(target.path);
      }
    });

  const stash = (mode: 'copy' | 'cut', nodes: Node[]) => {
    const paths = actionable(nodes).map((n) => n.path);
    if (paths.length) clipboard.current = { mode, paths };
  };

  const paste = (node: Node) =>
    run(async () => {
      const clip = clipboard.current;
      if (!clip || node.outside) return;
      const dir = isDir(node) ? node.path : relPath.dirname(node.path);
      const reload = new Set([dir]);
      try {
        for (const from of clip.paths) {
          const name = relPath.basename(from);
          if (clip.mode === 'copy') {
            await api.fsCopy(project.id, from, relPath.join(dir, name));
          } else if (relPath.dirname(from) !== dir && !relPath.isUnder(dir, from)) {
            const to = relPath.join(dir, name);
            await api.fsMove(project.id, from, to);
            onMoved(project.id, from, to);
            reload.add(relPath.dirname(from));
          }
        }
        if (clip.mode === 'cut') clipboard.current = undefined;
      } finally {
        for (const d of reload) reloadDir(d);
        expand(nodeId(project.id, dir));
      }
    });

  const selectedDir = () => {
    const picked = tree.current?.selection() ?? [];
    return picked.length === 1 && !picked[0]!.outside ? picked[0]! : rootNode;
  };
  useImperativeHandle(apiRef, () => ({
    newFile: () => void create('file', selectedDir()),
    newFolder: () => void create('dir', selectedDir()),
    refresh: () => {
      folderFiles.current.clear();
      tree.current?.reload();
    },
    collapseAll: () => onExpandedChange([nodeId(project.id, '')]),
    reveal,
  }));

  const menuItems = (node: Node, selection: Node[]): Array<ContextMenuItem | 'sep'> => {
    const disabled = !!node.outside;
    const item = (id: string, label: string, act: () => void, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({ id, label, run: act, disabled, ...extra });
    const call = (job: () => Promise<unknown>) => () => void run(async () => void (await job()));
    if (selection.length > 1) {
      return [
        item('copy', t('explorer.copy'), () => stash('copy', selection), { icon: 'copy', hint: 'Ctrl+C' }),
        item('cut', t('explorer.cut'), () => stash('cut', selection), { hint: 'Ctrl+X' }),
      ];
    }
    return [
      ...(isDir(node) ? [] : [item('open', t('explorer.open'), () => open(node), { icon: 'file' })]),
      ...(isDir(node) || !onOpenFileToSide ? [] : [item('openSide', t('explorer.openSide'), () => onOpenFileToSide(project.id, node.path), { icon: 'split', hint: 'Ctrl+Enter' })]),
      item('newFile', t('explorer.newFile'), () => void create('file', node), { icon: 'plus' }),
      item('newDir', t('explorer.newFolder'), () => void create('dir', node), { icon: 'folder' }),
      'sep',
      ...(isRoot(node) ? [] : [item('copy', t('explorer.copy'), () => stash('copy', [node]), { icon: 'copy', hint: 'Ctrl+C' }), item('cut', t('explorer.cut'), () => stash('cut', [node]), { hint: 'Ctrl+X' })]),
      item('paste', t('explorer.paste'), () => void paste(node), { hint: 'Ctrl+V', disabled: disabled || !clipboard.current }),
      ...(isRoot(node)
        ? []
        : [
            item('rename', t('explorer.rename'), () => tree.current?.startRename(nodeId(project.id, node.path)), { icon: 'edit', hint: 'F2' }),
            item('delete', t('explorer.delete'), () => void remove(node), { icon: 'trash', hint: 'Del', danger: true }),
            'sep' as const,
          ]),
      item('copyFullPath', t('explorer.copyFullPath'), () => copyPath(fullPath(project.path, node.path)), { icon: 'copy', disabled: false }),
      ...(isRoot(node) ? [] : [item('copyPath', t('explorer.copyPath'), () => copyPath(node.path), { icon: 'copy', disabled: false })]),
      'sep' as const,
      ...(isDir(node) ? [item('openTerminal', t('explorer.openTerminal'), () => onOpenTerminal(project.id, node.path), { icon: 'terminal', disabled })] : []),
      item('reveal', t('explorer.reveal'), call(() => api.fsReveal(project.id, node.path))),
      ...(editors.data ?? []).map((editor) =>
        item(`editor-${editor.id}`, t('explorer.openInEditor', { editor: editor.name }), call(() => api.openInEditor(editor.id, project.id, node.path)), {
          disabled: disabled || editor.path === null,
          hint: editor.path === null ? t('explorer.editorMissing') : undefined,
        }),
      ),
      ...(isDir(node) ? [] : [item('openDefault', t('explorer.openDefault'), call(() => api.fsOpen(project.id, node.path)))]),
    ];
  };

  return (
    <section className="xp-project">
      {element}
      <TreeView
        ref={tree}
        roots={roots}
        idOf={(n) => nodeId(n.project, n.path)}
        labelOf={(n) => (n.outside ? `${n.name} (${t('explorer.outside')})` : n.name)}
        iconOf={iconOf}
        iconToneOf={(n) => (isDir(n) ? undefined : fileIconOf(n.name).tone)}
        hasChildren={(n) => isDir(n)}
        loadChildren={loadChildren}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        onOpen={open}
        onOpenToSide={onOpenFileToSide && ((node) => !node.outside && onOpenFileToSide(project.id, node.path))}
        onPreview={onPreviewFile && ((node) => !node.outside && onPreviewFile(project.id, node.path))}
        onContextMenu={(node, e) => setMenu({ at: { x: e.clientX, y: e.clientY }, node, selection: tree.current?.selection() ?? [node] })}
        onRename={(node, name) => void rename(node, name)}
        onDelete={(nodes) => nodes.length === 1 && void remove(nodes[0]!)}
        onCopy={(nodes) => stash('copy', nodes)}
        onCut={(nodes) => stash('cut', nodes)}
        onPaste={(node) => void paste(node)}
        draggable
        onDrop={(dragged, target) => void move(dragged, target)}
      />
      {menu && <ContextMenu at={menu.at} items={menuItems(menu.node, menu.selection)} onClose={() => setMenu(undefined)} />}
    </section>
  );
}
