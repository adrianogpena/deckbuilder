import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import {
  ContextMenu,
  type ContextMenuItem,
  errorMessage,
  errorOf,
  fileIconOf,
  FileNesting,
  folderIconOf,
  type NestingPatterns,
  relPath,
  TreeView,
  type TreeViewHandle,
  useAsync,
  useDialogs,
  useToast,
} from '@deckbuilder/ui';
import { MULTI_DELETE_ENABLED } from '../../../../app';
import { api, type FsEntry, type Project } from '../../api';
import { fullPath, nodeId } from '../../explorer-paths';
import { t } from '../../i18n';
import { useCopyPath } from './copy-path';
import type { FileUndo, UndoOp } from './file-undo';
import { entriesOf, freeName, walkEntry } from './os-drop';
import type { FindResult } from './tree-find';

interface Node {
  project: string;
  path: string;
  name: string;
  kind: FsEntry['kind'];
  outside?: boolean;
  target?: FsEntry['target'];
  excluded?: true;
  /** Files shown under this file (file nesting); they are in the same folder on disk. */
  nested?: Node[];
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
  undo: FileUndo;
  /** How many of these project paths (or files under them) are open with unsaved changes. */
  dirtyCount?(project: string, paths: string[]): number;
  /** Which entries the tree lists and in what order; a change reloads the tree. */
  view?: TreeViewOptions;
  /** Folders holding a single folder share a row. */
  compact?: boolean;
  /** File nesting patterns; absent: files are not nested. */
  nesting?: NestingPatterns;
  /** Find in the tree: `highlight` marks matches and counts them on folders, `filter` also hides everything else. */
  find?: { mode: 'highlight' | 'filter'; result: FindResult };
}

export interface TreeViewOptions {
  exclude: string[];
  sort: string;
  showExcluded: boolean;
}

const DID: Record<UndoOp['kind'], 'explorer.did.create' | 'explorer.did.rename' | 'explorer.did.move' | 'explorer.did.copy'> = {
  create: 'explorer.did.create',
  rename: 'explorer.did.rename',
  move: 'explorer.did.move',
  copy: 'explorer.did.copy',
};
const MAX_LISTED = 10;
const MAX_FORCED = 400;
const UPLOAD_PARALLEL = 3;
const LINK_FRESH_MS = 50_000;

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
export function ProjectTree({ project, expanded, onExpandedChange, onOpenFile, onPreviewFile, onOpenFileToSide, onOpenTerminal, onMoved, onDeleted, apiRef, undo, dirtyCount, view, compact, nesting, find }: ProjectTreeProps) {
  const tree = useRef<TreeViewHandle<Node>>(null);
  const clipboard = useRef<{ mode: 'copy' | 'cut'; paths: string[] }>();
  const { confirm, choose, element } = useDialogs();
  const [creating, setCreating] = useState<{ dir: string; kind: 'file' | 'dir' }>();
  const toast = useToast();
  const copyPath = useCopyPath();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; node: Node; selection: Node[] }>();
  const editors = useAsync(() => api.editors(), []);

  const folderFiles = useRef(new Map<string, string[]>());
  const outLink = useRef<{ id: string; url: string; name: string; at: number }>();

  const roots = useMemo<Node[]>(() => [{ project: project.id, path: '', name: project.name, kind: 'dir' }], [project.id, project.name]);

  const forced = useMemo(
    () => (find?.mode === 'filter' ? new Set([...find.result.counts.keys()].slice(0, MAX_FORCED).map((dir) => nodeId(project.id, dir))) : undefined),
    [find, project.id],
  );
  const visibleOf = useMemo(() => {
    if (find?.mode !== 'filter') return undefined;
    const { matches, counts } = find.result;
    const shows = (n: Node): boolean => n.path === '' || matches.has(n.path) || counts.has(n.path) || !!n.nested?.some(shows);
    return shows;
  }, [find]);
  const markOf = useMemo(() => {
    if (!find) return undefined;
    const { matches, counts } = find.result;
    return (n: Node) => {
      const positions = matches.get(n.path);
      const count = isDir(n) ? counts.get(n.path) : undefined;
      return positions || count ? { positions: positions ?? [], count } : undefined;
    };
  }, [find]);

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

  const nester = useMemo(() => nesting && new FileNesting(nesting), [JSON.stringify(nesting)]);
  const nestedOf = useRef(new Map<string, Node[]>());
  const nestParent = useRef(new Map<string, string>());

  const loadChildren = async (node: Node): Promise<Node[]> => {
    if (!isDir(node)) return nestedOf.current.get(nodeId(project.id, node.path)) ?? [];
    const entries = await api.fsList(project.id, node.path, view && { exclude: view.exclude, sort: view.sort, all: view.showExcluded });
    folderFiles.current.set(
      nodeId(project.id, node.path),
      entries.filter((e) => e.kind !== 'dir' && e.target !== 'dir').map((e) => e.name),
    );
    const nodes = entries.map((e): Node => ({
      project: project.id,
      path: relPath.join(node.path, e.name),
      name: e.name,
      kind: e.kind,
      outside: e.outside,
      target: e.target,
      excluded: e.excluded,
    }));
    if (!nester) return nodes;
    const byName = new Map(nodes.filter((n) => !isDir(n)).map((n) => [n.name, n]));
    const groups = nester.nest([...byName.keys()], node.path ? relPath.basename(node.path) : project.name);
    const hidden = new Set<string>();
    const changed: string[] = [];
    for (const [parent, children] of groups) {
      const id = nodeId(project.id, relPath.join(node.path, parent));
      const list = [...children].map((c) => byName.get(c)!);
      for (const child of list) {
        hidden.add(child.name);
        nestParent.current.set(nodeId(project.id, child.path), id);
      }
      if (list.length) {
        byName.get(parent)!.nested = list;
        nestedOf.current.set(id, list);
        changed.push(id);
      } else {
        nestedOf.current.delete(id);
      }
    }
    // Nested files that were loaded before this reload show the new list.
    setTimeout(() => changed.forEach((id) => tree.current?.reload(id)), 0);
    return nodes.filter((n) => !hidden.has(n.name));
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

  const viewKey = JSON.stringify([view, nesting]);
  const firstView = useRef(viewKey);
  useEffect(() => {
    if (firstView.current === viewKey) return;
    firstView.current = viewKey;
    folderFiles.current.clear();
    tree.current?.reload();
  }, [viewKey]);

  const rootNode = roots[0]!;
  const reveal = (path: string) => {
    const missing: string[] = [];
    for (let dir = relPath.dirname(path); ; dir = relPath.dirname(dir)) {
      const id = nodeId(project.id, dir);
      if (!expanded.includes(id)) missing.push(id);
      if (dir === '') break;
    }
    const holder = nestParent.current.get(nodeId(project.id, path));
    if (holder && !expanded.includes(holder)) missing.push(holder);
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

  const record = (op: UndoOp, name: string, key?: string) => {
    undo.push(op);
    toast({ key, message: t(DID[op.kind], { name }), action: { label: t('explorer.undo'), run: () => void undoOp(op) } });
  };
  const labelOf = (paths: string[]) => (paths.length === 1 ? relPath.basename(paths[0]!) : t('explorer.items', { count: paths.length }));

  const create = (kind: 'file' | 'dir', node: Node) => {
    if (node.outside) return;
    const dir = isDir(node) ? node.path : relPath.dirname(node.path);
    expand(nodeId(project.id, dir));
    setCreating({ dir, kind });
  };

  const submitNew = async (c: { dir: string; kind: 'file' | 'dir' }, raw: string): Promise<string | null> => {
    const parts = raw.replace(/\\/g, '/').split('/').map((x) => x.trim());
    if (parts.some((x) => !x || x === '.' || x === '..')) return t('explorer.nameInvalid');
    const path = relPath.join(c.dir, parts.join('/'));
    try {
      await api.fsCreate(project.id, path, c.kind);
    } catch (err) {
      reloadDir(c.dir);
      return errorMessage(errorOf(err));
    }
    setCreating(undefined);
    reloadDir(c.dir);
    reveal(path);
    if (c.kind === 'file') onOpenFile(project.id, path);
    record({ kind: 'create', project: project.id, paths: [path] }, relPath.basename(path));
    return null;
  };

  const rename = (node: Node, name: string) =>
    run(async () => {
      if (isRoot(node) || node.outside) return;
      const to = relPath.join(relPath.dirname(node.path), name);
      await api.fsRename(project.id, node.path, name);
      onMoved(project.id, node.path, to);
      reloadDir(relPath.dirname(node.path));
      record({ kind: 'rename', project: project.id, moves: [{ from: node.path, to }] }, name);
    });

  const actionable = (nodes: Node[]) => nodes.filter((n) => !isRoot(n) && !n.outside);

  const remove = (nodes: Node[]) =>
    run(async () => {
      const targets = actionable(nodes);
      if (!targets.length) return;
      if (targets.length > 1 && !MULTI_DELETE_ENABLED) {
        toast({ message: t('explorer.deleteOne') });
        return;
      }
      const dirty = dirtyCount?.(project.id, targets.map((n) => n.path)) ?? 0;
      const ok = await confirm({
        title: t('explorer.deleteTitle'),
        body: (
          <>
            <p>{targets.length === 1 ? t('explorer.deleteBody', { name: targets[0]!.name }) : t('explorer.deleteMany', { count: targets.length })}</p>
            {targets.length > 1 && (
              <ul>
                {targets.slice(0, MAX_LISTED).map((n) => <li key={n.path}>{n.name}</li>)}
                {targets.length > MAX_LISTED && <li>{t('explorer.andMore', { count: targets.length - MAX_LISTED })}</li>}
              </ul>
            )}
            {dirty > 0 && <p>{t('explorer.dirtyDelete', { count: dirty })}</p>}
          </>
        ),
        okLabel: t('explorer.delete'),
        danger: true,
      });
      if (!ok) return;
      const parents = new Set(targets.map((n) => relPath.dirname(n.path)));
      try {
        for (const n of targets) {
          await api.fsDelete(project.id, [n.path]);
          onDeleted(project.id, n.path);
        }
      } finally {
        for (const dir of parents) reloadDir(dir);
      }
    });

  /** Moves `from` to `to`; an existing name asks Keep both / Replace. Returns the final path, or null when cancelled. */
  const moveOne = async (from: string, to: string): Promise<string | null> => {
    const finalPath = (entry: FsEntry) => relPath.join(relPath.dirname(to), entry.name);
    try {
      return finalPath(await api.fsMove(project.id, from, to));
    } catch (err) {
      if (errorOf(err).code !== 'exists') throw err;
    }
    const choice = await choose({
      title: t('explorer.existsTitle'),
      body: t('explorer.existsBody', { name: relPath.basename(to) }),
      choices: [
        { id: 'keepBoth', label: t('explorer.keepBoth') },
        { id: 'replace', label: t('explorer.replace'), danger: true },
      ],
    });
    if (choice !== 'keepBoth' && choice !== 'replace') return null;
    return finalPath(await api.fsMove(project.id, from, to, choice));
  };

  const moveInto = async (froms: string[], dir: string) => {
    if (!froms.length) return;
    const dirty = dirtyCount?.(project.id, froms) ?? 0;
    if (dirty > 0 && !(await confirm({ title: t('explorer.dirtyTitle'), body: t('explorer.dirtyMove', { count: dirty }) }))) return;
    const moves: Array<{ from: string; to: string }> = [];
    const reload = new Set([dir]);
    try {
      for (const from of froms) {
        const to = await moveOne(from, relPath.join(dir, relPath.basename(from)));
        if (to === null) break;
        onMoved(project.id, from, to);
        moves.push({ from, to });
        reload.add(relPath.dirname(from));
      }
    } finally {
      for (const d of reload) reloadDir(d);
      expand(nodeId(project.id, dir));
    }
    if (moves.length) record({ kind: 'move', project: project.id, moves }, labelOf(moves.map((m) => m.to)));
  };

  // The copy route names clashes "name copy.ext", "name copy 2.ext", so pasting in place works.
  const copyInto = async (froms: string[], dir: string) => {
    const created: string[] = [];
    try {
      for (const from of froms) {
        const entry = await api.fsCopy(project.id, from, relPath.join(dir, relPath.basename(from)));
        created.push(relPath.join(dir, entry.name));
      }
    } finally {
      reloadDir(dir);
      expand(nodeId(project.id, dir));
    }
    if (created.length) record({ kind: 'copy', project: project.id, paths: created }, labelOf(created));
  };

  const undoOp = (op: UndoOp) =>
    run(async () => {
      if (!undo.take(op)) return;
      try {
        if ('paths' in op) {
          const ok = await confirm({
            title: t('explorer.undoDeleteTitle'),
            body: t('explorer.undoDeleteBody', { name: labelOf(op.paths) }),
            okLabel: t('explorer.undo'),
            danger: true,
          });
          if (!ok) return void undo.push(op);
          for (const path of op.paths) {
            await api.fsDelete(op.project, [path]);
            onDeleted(op.project, path);
          }
          toast({ message: t('explorer.undone', { what: t(DID[op.kind], { name: labelOf(op.paths) }) }) });
        } else {
          for (const m of [...op.moves].reverse()) {
            await api.fsMove(op.project, m.to, m.from);
            onMoved(op.project, m.to, m.from);
          }
          toast({ message: t('explorer.undone', { what: t(DID[op.kind], { name: labelOf(op.moves.map((m) => m.to)) }) }) });
        }
      } finally {
        folderFiles.current.clear();
        tree.current?.reload();
      }
    });

  const undoLast = () => {
    const op = undo.last();
    if (op) void undoOp(op);
    else toast({ message: t('explorer.undoNothing') });
  };

  const stash = (mode: 'copy' | 'cut', nodes: Node[]) => {
    const paths = actionable(nodes).map((n) => n.path);
    if (paths.length) clipboard.current = { mode, paths };
  };

  const paste = (node: Node) =>
    run(async () => {
      const clip = clipboard.current;
      if (!clip || node.outside) return;
      const dir = isDir(node) ? node.path : relPath.dirname(node.path);
      if (clip.mode === 'copy') return copyInto(clip.paths, dir);
      await moveInto(clip.paths.filter((from) => relPath.dirname(from) !== dir && !relPath.isUnder(dir, from)), dir);
      clipboard.current = undefined;
    });

  /**
   * Files and folders dragged in from the OS. A top-level name that is taken asks Skip / Keep both / Replace
   * (once for all with the checkbox); what is inside a dropped folder is not compared. Up to UPLOAD_PARALLEL files go at once.
   */
  const dropFiles = (data: DataTransfer, target: Node) => {
    const entries = entriesOf(data);
    if (target.outside || !entries.length) return;
    void run(async () => {
      const dir = target.path;
      const fold = /Windows|Mac/.test(navigator.userAgent) ? (n: string) => n.toLowerCase() : (n: string) => n;
      const taken = new Set((await api.fsList(project.id, dir)).map((e) => fold(e.name)));
      let all: 'skip' | 'keepBoth' | 'replace' | undefined;
      const jobs: Array<{ name: string; tree: Awaited<ReturnType<typeof walkEntry>>; isDir: boolean }> = [];
      for (const entry of entries) {
        let name = entry.name;
        if (taken.has(fold(name))) {
          let choice = all;
          if (!choice) {
            let applyAll = false;
            const picked = await choose({
              title: t('explorer.existsTitle'),
              body: t('explorer.existsBody', { name }),
              choices: [
                { id: 'keepBoth', label: t('explorer.keepBoth') },
                { id: 'replace', label: t('explorer.replace'), danger: true },
                { id: 'skip', label: t('explorer.skip') },
              ],
              checkbox: entries.length > 1 ? { label: t('explorer.applyToAll'), onChange: (v) => (applyAll = v) } : undefined,
            });
            if (picked !== 'keepBoth' && picked !== 'replace' && picked !== 'skip') return;
            choice = picked;
            if (applyAll) all = choice;
          }
          if (choice === 'skip') continue;
          if (choice === 'keepBoth') name = freeName(name, entry.isDirectory, taken, fold);
          else await api.fsDelete(project.id, [relPath.join(dir, name)]);
        }
        taken.add(fold(name));
        jobs.push({ name, tree: await walkEntry(entry), isDir: entry.isDirectory });
      }

      const under = (j: (typeof jobs)[number], rel: string[]) => [dir, j.name, ...rel.slice(1)].filter(Boolean).join('/');
      const files = jobs.flatMap((j) => j.tree.files.map((f) => ({ path: under(j, f.rel), file: f.file })));
      const emptyDirs = jobs.flatMap((j) => j.tree.emptyDirs.map((rel) => under(j, rel)));
      let done = 0;
      let failed = 0;
      let firstError: unknown;
      const progress = () => {
        if (files.length > 1) toast({ key: 'upload', message: t('explorer.uploading', { done, total: files.length }), timeout: 0 });
      };
      progress();
      try {
        for (const path of emptyDirs) await api.fsCreate(project.id, path, 'dir').catch((err) => { if (errorOf(err).code !== 'exists') throw err; });
        const queue = [...files];
        await Promise.all(
          Array.from({ length: Math.min(UPLOAD_PARALLEL, queue.length) }, async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              try {
                await api.fsUpload(project.id, next.path, next.file);
              } catch (err) {
                failed++;
                firstError ??= err;
              }
              done++;
              progress();
            }
          }),
        );
      } finally {
        reloadDir(dir);
        expand(nodeId(project.id, dir));
      }
      const created = jobs.map((j) => relPath.join(dir, j.name));
      if (failed) {
        toast({ key: 'upload', kind: 'error', message: t('explorer.uploadFailed', { count: failed, error: errorMessage(errorOf(firstError)) }) });
      } else if (created.length) {
        record({ kind: 'copy', project: project.id, paths: created }, labelOf(created), 'upload');
        if (created.length === 1 && !jobs[0]!.isDir) onOpenFile(project.id, created[0]!);
      }
    });
  };

  // The OS fetches a dragged-out file by URL with no headers; the link is made on pointer down so it is there at dragstart.
  const prepareDragOut = (node: Node) => {
    if (isDir(node) || node.outside) return;
    const id = nodeId(project.id, node.path);
    api.fsDownloadTicket(project.id, node.path).then(
      ({ ticket, name }) => (outLink.current = { id, name, url: `${window.location.origin}/api/fs/download?t=${ticket}`, at: Date.now() }),
      () => {},
    );
  };
  const dragOutLink = (node: Node) => {
    const link = outLink.current;
    outLink.current = undefined;
    return link && link.id === nodeId(project.id, node.path) && Date.now() - link.at < LINK_FRESH_MS ? link : undefined;
  };

  const drop = (dragged: Node[], target: Node, copy: boolean) =>
    run(async () => {
      if (target.outside) return;
      const nodes = actionable(dragged).filter((n) => !relPath.isUnder(target.path, n.path));
      if (copy) await copyInto(nodes.map((n) => n.path), target.path);
      else await moveInto(nodes.filter((n) => relPath.dirname(n.path) !== target.path).map((n) => n.path), target.path);
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
        item('delete', t('explorer.delete'), () => void remove(selection), {
          icon: 'trash',
          hint: MULTI_DELETE_ENABLED ? 'Del' : t('explorer.deleteOne'),
          danger: true,
          disabled: disabled || !MULTI_DELETE_ENABLED,
        }),
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
            item('delete', t('explorer.delete'), () => void remove([node]), { icon: 'trash', hint: 'Del', danger: true }),
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
        dimmedOf={(n) => !!n.excluded}
        iconToneOf={(n) => (isDir(n) ? undefined : fileIconOf(n.name).tone)}
        hasChildren={(n) => isDir(n) || !!n.nested?.length}
        isFolder={isDir}
        compact={compact}
        visibleOf={visibleOf}
        markOf={markOf}
        forceExpanded={forced}
        loadChildren={loadChildren}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        onOpen={open}
        onOpenToSide={onOpenFileToSide && ((node) => !node.outside && onOpenFileToSide(project.id, node.path))}
        onPreview={onPreviewFile && ((node) => !node.outside && onPreviewFile(project.id, node.path))}
        onContextMenu={(node, e) => setMenu({ at: { x: e.clientX, y: e.clientY }, node, selection: tree.current?.selection() ?? [node] })}
        onRename={(node, name) => void rename(node, name)}
        onDelete={(nodes) => void remove(nodes)}
        onCopy={(nodes) => stash('copy', nodes)}
        onCut={(nodes) => stash('cut', nodes)}
        onPaste={(node) => void paste(node)}
        onUndo={undoLast}
        newEntry={creating && { parentId: nodeId(project.id, creating.dir), kind: creating.kind, onSubmit: (name) => submitNew(creating, name), onCancel: () => setCreating(undefined) }}
        draggable
        onDrop={(dragged, target, copy) => void drop(dragged, target, copy)}
        onDropFiles={dropFiles}
        dragOut={{ prepare: prepareDragOut, link: dragOutLink }}
      />
      {menu && <ContextMenu at={menu.at} items={menuItems(menu.node, menu.selection)} onClose={() => setMenu(undefined)} />}
    </section>
  );
}
