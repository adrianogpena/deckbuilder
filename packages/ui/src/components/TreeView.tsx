import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { errorMessage, errorOf, type ApiError } from '../api';
import { t } from '../i18n';
import type { IconName } from '../icons';
import { firstChildId, isInside, nextId, parentId, prevId, subtreeIds, visibleRows, type TreeRow } from '../tree';
import { Icon, Spinner, type Tone } from './ui';

export const TREE_DRAG_TYPE = 'application/x-deckbuilder-tree';
const TYPEAHEAD_MS = 700;
const INDENT = 14;
const HOVER_EXPAND_MS = 500;
const SCROLL_EDGE = 28;

/** Children of a node; `children` stays set while a reload runs so the rows don't flicker. */
type Entry<N> = { status: 'loading'; children?: N[] } | { status: 'error'; error: ApiError } | { status: 'ok'; children: N[] };

export interface TreeViewProps<N> {
  roots: N[];
  idOf: (node: N) => string;
  labelOf: (node: N) => string;
  iconOf?: (node: N) => IconName;
  iconToneOf?: (node: N) => Tone | undefined;
  /** The row is drawn dimmed (an excluded entry). */
  dimmedOf?: (node: N) => boolean;
  hasChildren: (node: N) => boolean;
  /** Called on the first expand of a node; the result is cached per id until `reload`. */
  loadChildren: (node: N) => Promise<N[]>;
  expanded: string[];
  onExpandedChange: (expanded: string[]) => void;
  /** Uncontrolled (kept inside) when omitted. */
  selected?: string | null;
  onSelect?: (node: N) => void;
  /** Enter on any row, double-click on a row without children. */
  onOpen?: (node: N) => void;
  /** A plain click (no Ctrl or Shift) on a row without children, before a possible double-click. */
  onPreview?: (node: N) => void;
  /** Ctrl+Enter, or Alt+click, on a row without children. */
  onOpenToSide?: (node: N) => void;
  onContextMenu?: (node: N, e: MouseEvent) => void;
  /** F2 or `startRename` show an inline input; Enter or leaving it commits, Escape cancels. */
  onRename?: (node: N, name: string) => void;
  /** Delete on the selected rows (Ctrl/Shift+click and Shift+Arrows select several). */
  onDelete?: (nodes: N[]) => void;
  /** Ctrl+C / Ctrl+X on the selected rows. */
  onCopy?: (nodes: N[]) => void;
  onCut?: (nodes: N[]) => void;
  /** Ctrl+V with `target` as the focused row. */
  onPaste?: (target: N) => void;
  /** Ctrl+Z with the tree focused. */
  onUndo?: () => void;
  /** An input row for a new entry as the first child of the (expanded) node `parentId`. */
  newEntry?: {
    parentId: string;
    kind: 'file' | 'dir';
    /** Enter or leaving the input with a name; returns the error to show inline, or null once done. Esc or an empty name calls `onCancel`. */
    onSubmit: (name: string) => Promise<string | null>;
    onCancel: () => void;
  };
  draggable?: boolean;
  /** Rows dragged (the whole selection when one of its rows is dragged) onto a row with children, never onto themselves or their descendants; `copy` when Ctrl was held. */
  onDrop?: (dragged: N[], target: N, copy: boolean) => void;
  /**
   * Files or folders dragged in from the OS onto a folder row (a file row means its folder, empty space the first root).
   * Read `data.items` before the first await: the browser empties it after the event.
   */
  onDropFiles?: (data: DataTransfer, target: N) => void;
  /**
   * Dragging a single row out to the OS (Chromium's `DownloadURL`): `prepare` runs on pointer down, so an async link can be
   * ready when the drag starts; `link` returns it then, or undefined for a row that can't leave the app.
   */
  dragOut?: { prepare: (node: N) => void; link: (node: N) => { name: string; url: string } | undefined };
}

export interface TreeViewHandle<N = unknown> {
  /** Reloads the children of `id`, or of every loaded node; collapsed ones are dropped from the cache instead. */
  reload: (id?: string) => void;
  startRename: (id: string) => void;
  /** Selects and scrolls to `id` once its row is there (its ancestors must be expanded); no focus change. */
  reveal: (id: string) => void;
  /** The selected nodes in display order. */
  selection: () => N[];
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <input
      ref={input}
      className="tree-rename"
      defaultValue={initial}
      aria-label={t('tree.rename')}
      onClick={stop}
      onDoubleClick={stop}
      onMouseDown={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function NewEntryInput({ kind, depth, onSubmit, onCancel }: { kind: 'file' | 'dir'; depth: number } & Pick<NonNullable<TreeViewProps<unknown>['newEntry']>, 'onSubmit' | 'onCancel'>) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = async (value: string) => {
    if (busy.current) return;
    if (!value.trim()) return onCancel();
    busy.current = true;
    const err = await onSubmit(value.trim());
    busy.current = false;
    if (err !== null) {
      setError(err);
      input.current?.focus();
    }
  };
  return (
    <div className="tree-row tree-new" style={{ paddingLeft: (depth + 1) * INDENT + 4 }}>
      <span className="tree-chevron" />
      <span className="tree-icon">
        <Icon name={kind === 'dir' ? 'folder' : 'file'} size={15} />
      </span>
      <input
        ref={input}
        className="tree-rename"
        aria-label={t('tree.newName')}
        aria-invalid={error !== null}
        onChange={() => setError(null)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => {
          if (error === null) void submit(e.currentTarget.value);
        }}
      />
      {error !== null && <div className="tree-new-error" role="alert">{error}</div>}
    </div>
  );
}

function TreeViewInner<N>(props: TreeViewProps<N>, ref: Ref<TreeViewHandle<N>>) {
  const { roots, idOf, labelOf, iconOf, iconToneOf, dimmedOf, hasChildren, expanded, onExpandedChange, onOpen, onPreview, onOpenToSide, onContextMenu, onRename, onDelete, onCopy, onCut, onPaste, onUndo, newEntry, draggable, onDrop, onDropFiles, dragOut } = props;
  const cache = useRef(new Map<string, Entry<N>>());
  const generations = useRef(new Map<string, number>());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const selected = props.selected !== undefined ? props.selected : ownSelected;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const hoverTimer = useRef<{ id: string; timer: number }>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const dragged = useRef<Array<{ id: string; node: N }> | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const focusNext = useRef<string | null>(null);
  const revealNext = useRef<string | null>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const latest = useRef(props);
  latest.current = props;

  const expandedSet = new Set(expanded);
  const childrenOf = (id: string) => {
    const entry = cache.current.get(id);
    return entry?.status === 'error' ? undefined : entry?.children;
  };
  const rows = visibleRows(roots, childrenOf, expandedSet, idOf);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const rowOf = (id: string | null) => (id === null ? undefined : rows.find((r) => r.id === id));
  const current = rowOf(selected);
  const isPicked = (id: string) => id === selected || picked.has(id);
  const pickedRows = () => rowsRef.current.filter((r) => isPicked(r.id));

  const bumpGeneration = (id: string) => {
    const gen = (generations.current.get(id) ?? 0) + 1;
    generations.current.set(id, gen);
    return gen;
  };

  const load = (node: N, id: string) => {
    const gen = bumpGeneration(id);
    cache.current.set(id, { status: 'loading', children: childrenOf(id) });
    bump();
    latest.current.loadChildren(node).then(
      (children) => {
        if (generations.current.get(id) !== gen) return;
        const kept = new Set(children.map(idOf));
        const missing = (childrenOf(id) ?? []).map(idOf).filter((c) => !kept.has(c));
        for (const gone of subtreeIds(missing, childrenOf, idOf)) {
          bumpGeneration(gone);
          cache.current.delete(gone);
        }
        cache.current.set(id, { status: 'ok', children });
        bump();
      },
      (err) => {
        if (generations.current.get(id) !== gen) return;
        cache.current.set(id, { status: 'error', error: errorOf(err) });
        bump();
      },
    );
  };

  // Expanded rows whose children aren't loaded yet (first expand, restored state, after a reload).
  useEffect(() => {
    for (const row of rows) {
      if (expandedSet.has(row.id) && !cache.current.has(row.id) && hasChildren(row.node)) load(row.node, row.id);
    }
  });

  useEffect(() => {
    const id = focusNext.current;
    if (id === null) return;
    focusNext.current = null;
    rowEls.current.get(id)?.focus();
  });

  useEffect(() => {
    const id = revealNext.current;
    if (id === null) return;
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row) return;
    revealNext.current = null;
    select(row, false);
    rowEls.current.get(id)?.scrollIntoView({ block: 'nearest' });
  });

  const select = (row: TreeRow<N>, focus = true, extend = false) => {
    if (row.id !== revealNext.current) revealNext.current = null;
    if (!extend) {
      anchor.current = row.id;
      setPicked(new Set());
    }
    if (latest.current.selected === undefined) setOwnSelected(row.id);
    if (row.id !== selected) latest.current.onSelect?.(row.node);
    if (focus) focusNext.current = row.id;
  };

  const startRename = (id: string) => {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || !latest.current.onRename) return;
    select(row, false);
    setRenaming(id);
  };

  const selectRange = (to: TreeRow<N>) => {
    const all = rowsRef.current;
    const a = all.findIndex((r) => r.id === (anchor.current ?? current?.id));
    const b = all.indexOf(to);
    if (a < 0 || b < 0) return select(to);
    setPicked(new Set(all.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id)));
    select(to, true, true);
  };

  const toggle = (row: TreeRow<N>) => {
    const next = new Set(pickedRows().map((r) => r.id));
    anchor.current = row.id;
    if (!next.delete(row.id)) {
      next.add(row.id);
      setPicked(next);
      return select(row, false, true);
    }
    const rest = rowsRef.current.filter((r) => next.has(r.id));
    if (!rest.length) return;
    setPicked(next);
    select(rest[rest.length - 1], false, true);
  };

  useImperativeHandle(ref, () => ({
    selection: () => pickedRows().map((r) => r.node),
    reload(id?: string) {
      const ids = id === undefined ? [...cache.current.keys()] : [id];
      const open = new Set(latest.current.expanded);
      for (const key of ids) {
        const row = rowsRef.current.find((r) => r.id === key);
        if (row && open.has(key)) {
          load(row.node, key);
        } else {
          bumpGeneration(key);
          cache.current.delete(key);
        }
      }
      bump();
    },
    startRename,
    reveal(id: string) {
      revealNext.current = id;
      bump();
    },
  }));

  const setOpen = (row: TreeRow<N>, open: boolean) => {
    if (open === expandedSet.has(row.id)) return;
    if (!open && selected !== null && selected !== row.id && isInside(rows, selected, row.id)) select(row);
    onExpandedChange(open ? [...expanded, row.id] : expanded.filter((x) => x !== row.id));
  };

  const open = (row: TreeRow<N>) => {
    if (onOpen) onOpen(row.node);
    else if (hasChildren(row.node)) setOpen(row, !expandedSet.has(row.id));
  };

  const typeAhead = (key: string) => {
    const now = Date.now();
    const ta = typeahead.current;
    ta.text = now - ta.at > TYPEAHEAD_MS ? key.toLowerCase() : ta.text + key.toLowerCase();
    ta.at = now;
    const at = current ? rows.indexOf(current) : -1;
    // A longer prefix may still match the current row; a new first letter moves on.
    const from = Math.max(0, ta.text.length > 1 ? at : at + 1);
    for (let k = 0; k < rows.length; k++) {
      const row = rows[(from + k) % rows.length];
      if (labelOf(row.node).toLowerCase().startsWith(ta.text)) {
        select(row);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).getAttribute('role') !== 'treeitem') return;
    if (renaming !== null || e.altKey || e.metaKey || !rows.length) return;
    const go = (id: string | null) => {
      const row = rowOf(id);
      if (!row) return;
      if (e.shiftKey) selectRange(row);
      else select(row);
    };
    const first = rows[0];
    const last = rows[rows.length - 1];
    let handled = true;
    if (e.key === 'ArrowDown') go(current ? nextId(rows, current.id) : first.id);
    else if (e.key === 'ArrowUp') go(current ? prevId(rows, current.id) : last.id);
    else if (e.key === 'Home') go(first.id);
    else if (e.key === 'End') go(last.id);
    else if (e.key.length === 1 && !e.ctrlKey) typeAhead(e.key);
    else if (!current) handled = false;
    else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      setPicked(new Set(rows.map((r) => r.id)));
      anchor.current = first.id;
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && onCopy) onCopy(pickedRows().map((r) => r.node));
    else if (e.ctrlKey && e.key.toLowerCase() === 'x' && onCut) onCut(pickedRows().map((r) => r.node));
    else if (e.ctrlKey && e.key.toLowerCase() === 'v' && onPaste) onPaste(current.node);
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && onUndo) onUndo();
    else if (e.key === 'ArrowLeft') {
      if (expandedSet.has(current.id) && hasChildren(current.node)) setOpen(current, false);
      else go(parentId(rows, current.id));
    } else if (e.key === 'ArrowRight') {
      if (!hasChildren(current.node)) return;
      if (!expandedSet.has(current.id)) setOpen(current, true);
      else go(firstChildId(rows, current.id));
    } else if (e.key === 'Enter') {
      if (e.ctrlKey && onOpenToSide) {
        if (!hasChildren(current.node)) onOpenToSide(current.node);
      } else open(current);
    }
    else if (e.key === 'F2' && onRename) startRename(current.id);
    else if (e.key === 'Delete' && onDelete) onDelete(pickedRows().map((r) => r.node));
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const finishRename = (row: TreeRow<N>, value: string | null) => {
    setRenaming(null);
    focusNext.current = row.id;
    const name = value?.trim();
    if (name && name !== labelOf(row.node)) latest.current.onRename?.(row.node, name);
  };

  const isFileDrag = (e: { dataTransfer: DataTransfer }) => !!onDropFiles && e.dataTransfer.types.includes('Files');
  // The folder an OS drop on `row` lands in: the row itself when it is a folder, else the folder holding it.
  const fileTargetOf = (row: TreeRow<N>) => (hasChildren(row.node) ? row : rows.find((r) => r.id === row.parentId));

  const canDrop = (row: TreeRow<N>) => {
    const d = dragged.current;
    return !!d && !!onDrop && hasChildren(row.node) && !d.some((x) => isInside(rows, row.id, x.id));
  };

  // The guide under the selected folder (or the folder holding the selected file) is drawn brighter.
  const activeGuide = (() => {
    const ids = new Set<string>();
    if (!current) return { level: -1, ids };
    const open = hasChildren(current.node) && expandedSet.has(current.id);
    const owner = open ? current : rows.find((r) => r.id === current.parentId);
    if (!owner) return { level: -1, ids };
    for (let i = rows.indexOf(owner) + 1; i < rows.length && rows[i].depth > owner.depth; i++) ids.add(rows[i].id);
    return { level: owner.depth, ids };
  })();

  const tabStop = current?.id ?? rows[0]?.id;

  const clearHover = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current.timer);
    hoverTimer.current = undefined;
  };
  useEffect(() => clearHover, []);

  // A collapsed folder under the pointer opens after a pause; near the top or bottom edge the list scrolls.
  const dragOverFolder = (row: TreeRow<N>) => {
    if (expandedSet.has(row.id)) return clearHover();
    if (hoverTimer.current?.id === row.id) return;
    clearHover();
    hoverTimer.current = { id: row.id, timer: window.setTimeout(() => latest.current.onExpandedChange([...latest.current.expanded, row.id]), HOVER_EXPAND_MS) };
  };
  const autoScroll = (e: { currentTarget: HTMLElement; clientY: number }) => {
    let el: HTMLElement | null = e.currentTarget;
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (e.clientY < box.top + SCROLL_EDGE) el.scrollTop -= 12;
    else if (e.clientY > box.bottom - SCROLL_EDGE) el.scrollTop += 12;
  };

  return (
    <div
      className="tree"
      role="tree"
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      onDragOver={
        draggable || onDropFiles
          ? (e) => {
              autoScroll(e);
              if (e.defaultPrevented || !isFileDrag(e) || !rows.length) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (dropTarget !== rows[0]!.id) setDropTarget(rows[0]!.id);
            }
          : undefined
      }
      onDragLeave={onDropFiles ? (e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropTarget(null) : undefined}
      onDrop={
        onDropFiles
          ? (e) => {
              if (e.defaultPrevented || !isFileDrag(e) || !rows.length) return;
              e.preventDefault();
              setDropTarget(null);
              onDropFiles(e.dataTransfer, rows[0]!.node);
            }
          : undefined
      }
    >
      {rows.map((row) => {
        const { node, id, depth } = row;
        const expandable = hasChildren(node);
        const isOpen = expandable && expandedSet.has(id);
        const entry = isOpen ? cache.current.get(id) : undefined;
        const icon = iconOf?.(node);
        const iconTone = iconToneOf?.(node);
        const guides = Array.from({ length: depth }, (_, level) => level);
        const statusIndent = { paddingLeft: (depth + 1) * INDENT + 22 };
        return (
          <Fragment key={id}>
            <div
              ref={(el) => (el ? rowEls.current.set(id, el) : rowEls.current.delete(id))}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={expandable ? isOpen : undefined}
              aria-selected={isPicked(id)}
              tabIndex={id === tabStop ? 0 : -1}
              className={`tree-row${isPicked(id) ? ' selected' : ''}${id === dropTarget ? ' drop-target' : ''}${dimmedOf?.(node) ? ' dim' : ''}`}
              style={{ paddingLeft: depth * INDENT + 4 }}
              draggable={draggable && renaming !== id}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) return toggle(row);
                if (e.shiftKey) return selectRange(row);
                select(row, false);
                if (e.altKey && onOpenToSide && !expandable) return onOpenToSide(node);
                if (expandable) setOpen(row, !isOpen);
                else onPreview?.(node);
              }}
              onDoubleClick={() => !expandable && onOpen?.(node)}
              onContextMenu={
                onContextMenu &&
                ((e) => {
                  e.preventDefault();
                  if (!isPicked(id)) select(row, false);
                  onContextMenu(node, e);
                })
              }
              onPointerDown={dragOut && draggable ? () => dragOut.prepare(node) : undefined}
              onDragStart={(e) => {
                e.dataTransfer.setData(TREE_DRAG_TYPE, id);
                e.dataTransfer.effectAllowed = 'copyMove';
                dragged.current = isPicked(id) ? pickedRows() : [{ id, node }];
                const out = dragged.current.length === 1 ? dragOut?.link(node) : undefined;
                if (out) e.dataTransfer.setData('DownloadURL', `application/octet-stream:${out.name}:${out.url}`);
              }}
              onDragEnd={() => {
                clearHover();
                dragged.current = null;
                setDropTarget(null);
              }}
              onDragOver={(e) => {
                if (isFileDrag(e)) {
                  const target = fileTargetOf(row);
                  if (!target) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (dropTarget !== target.id) setDropTarget(target.id);
                  return target === row ? dragOverFolder(row) : clearHover();
                }
                if (!e.dataTransfer.types.includes(TREE_DRAG_TYPE) || !canDrop(row)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                if (dropTarget !== id) setDropTarget(id);
                dragOverFolder(row);
              }}
              onDragLeave={() => {
                if (hoverTimer.current?.id === id) clearHover();
                if (dropTarget === id) setDropTarget(null);
              }}
              onDrop={(e) => {
                if (isFileDrag(e)) {
                  const target = fileTargetOf(row);
                  clearHover();
                  setDropTarget(null);
                  if (!target) return;
                  e.preventDefault();
                  onDropFiles!(e.dataTransfer, target.node);
                  return;
                }
                const d = dragged.current;
                clearHover();
                setDropTarget(null);
                if (!d || !canDrop(row)) return;
                e.preventDefault();
                dragged.current = null;
                onDrop?.(d.map((x) => x.node), node, e.ctrlKey);
              }}
            >
              {guides.map((level) => (
                <span key={level} className={`tree-guide${level === activeGuide.level && activeGuide.ids.has(id) ? ' active' : ''}`} style={{ left: level * INDENT + 12 }} />
              ))}
              <span className={`tree-chevron${isOpen ? ' open' : ''}`}>{expandable && <Icon name="chevron" size={14} />}</span>
              {icon && (
                <span className={`tree-icon${iconTone ? ` tone-${iconTone}` : ''}`}>
                  <Icon name={icon} size={15} />
                </span>
              )}
              {renaming === id ? (
                <RenameInput initial={labelOf(node)} onDone={(value) => finishRename(row, value)} />
              ) : (
                <span className="tree-label">{labelOf(node)}</span>
              )}
            </div>
            {isOpen && newEntry?.parentId === id && <NewEntryInput key={`new-${id}`} kind={newEntry.kind} depth={depth} onSubmit={newEntry.onSubmit} onCancel={newEntry.onCancel} />}
            {entry?.status === 'loading' && !entry.children && (
              <div className="tree-status" style={statusIndent}>
                <Spinner small />
                <span className="tree-label">{t('common.loading')}</span>
              </div>
            )}
            {entry?.status === 'error' && (
              <div className="tree-status tree-error" style={statusIndent}>
                <Icon name="alert" size={14} />
                <span className="tree-label" title={entry.error.detail}>{errorMessage(entry.error)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => load(node, id)}>
                  {t('common.retry')}
                </button>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Generic lazy tree: children load on the first expand, multi-selection (Ctrl/Shift+click,
 * Shift+Arrows, Ctrl+A) whose primary row follows the keyboard focus (Up/Down/Left/Right/Home/End, Enter, F2, Delete,
 * Ctrl+C/X/V, type-ahead), optional drag and drop.
 * The app owns `expanded` (and `selected` when given); a ref gives `reload` and `startRename`.
 */
export const TreeView = forwardRef(TreeViewInner) as <N>(props: TreeViewProps<N> & { ref?: Ref<TreeViewHandle<N>> }) => ReactElement;
