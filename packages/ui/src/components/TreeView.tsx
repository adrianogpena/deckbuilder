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

/** Children of a node; `children` stays set while a reload runs so the rows don't flicker. */
type Entry<N> = { status: 'loading'; children?: N[] } | { status: 'error'; error: ApiError } | { status: 'ok'; children: N[] };

export interface TreeViewProps<N> {
  roots: N[];
  idOf: (node: N) => string;
  labelOf: (node: N) => string;
  iconOf?: (node: N) => IconName;
  iconToneOf?: (node: N) => Tone | undefined;
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
  draggable?: boolean;
  /** Rows dragged (the whole selection when one of its rows is dragged) onto a row with children, never onto themselves or their descendants. */
  onDrop?: (dragged: N[], target: N) => void;
}

export interface TreeViewHandle<N = unknown> {
  /** Reloads the children of `id`, or of every loaded node; collapsed ones are dropped from the cache instead. */
  reload: (id?: string) => void;
  startRename: (id: string) => void;
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

function TreeViewInner<N>(props: TreeViewProps<N>, ref: Ref<TreeViewHandle<N>>) {
  const { roots, idOf, labelOf, iconOf, iconToneOf, hasChildren, expanded, onExpandedChange, onOpen, onContextMenu, onRename, onDelete, onCopy, onCut, onPaste, draggable, onDrop } = props;
  const cache = useRef(new Map<string, Entry<N>>());
  const generations = useRef(new Map<string, number>());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const selected = props.selected !== undefined ? props.selected : ownSelected;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const dragged = useRef<Array<{ id: string; node: N }> | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const focusNext = useRef<string | null>(null);
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

  const select = (row: TreeRow<N>, focus = true, extend = false) => {
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
    else if (e.key === 'ArrowLeft') {
      if (expandedSet.has(current.id) && hasChildren(current.node)) setOpen(current, false);
      else go(parentId(rows, current.id));
    } else if (e.key === 'ArrowRight') {
      if (!hasChildren(current.node)) return;
      if (!expandedSet.has(current.id)) setOpen(current, true);
      else go(firstChildId(rows, current.id));
    } else if (e.key === 'Enter') open(current);
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

  const canDrop = (row: TreeRow<N>) => {
    const d = dragged.current;
    return !!d && !!onDrop && hasChildren(row.node) && !d.some((x) => isInside(rows, row.id, x.id));
  };

  const tabStop = current?.id ?? rows[0]?.id;

  return (
    <div className="tree" role="tree" aria-multiselectable="true" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const { node, id, depth } = row;
        const expandable = hasChildren(node);
        const isOpen = expandable && expandedSet.has(id);
        const entry = isOpen ? cache.current.get(id) : undefined;
        const icon = iconOf?.(node);
        const iconTone = iconToneOf?.(node);
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
              className={`tree-row${isPicked(id) ? ' selected' : ''}${id === dropTarget ? ' drop-target' : ''}`}
              style={{ paddingLeft: depth * INDENT + 4 }}
              draggable={draggable && renaming !== id}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) return toggle(row);
                if (e.shiftKey) return selectRange(row);
                select(row, false);
                if (expandable) setOpen(row, !isOpen);
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
              onDragStart={(e) => {
                e.dataTransfer.setData(TREE_DRAG_TYPE, id);
                e.dataTransfer.effectAllowed = 'move';
                dragged.current = isPicked(id) ? pickedRows() : [{ id, node }];
              }}
              onDragEnd={() => {
                dragged.current = null;
                setDropTarget(null);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TREE_DRAG_TYPE) || !canDrop(row)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropTarget !== id) setDropTarget(id);
              }}
              onDragLeave={() => dropTarget === id && setDropTarget(null)}
              onDrop={(e) => {
                const d = dragged.current;
                setDropTarget(null);
                if (!d || !canDrop(row)) return;
                e.preventDefault();
                dragged.current = null;
                onDrop?.(d.map((x) => x.node), node);
              }}
            >
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
