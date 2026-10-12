/**
 * Visible rows of a TreeView. Pure functions over the roots, a children lookup and the set of
 * expanded ids, so keyboard moves are easy to test. Generic over the node type N.
 */

export interface TreeRow<N> {
  /** The last node of `chain`: the one whose children follow the row. */
  node: N;
  depth: number;
  /** Id of `node`. */
  id: string;
  /** Id of the parent row's `node`; null for a top-level row. */
  parentId: string | null;
  /** A compact row holds a chain of folders (each the only child of the one before); otherwise just the node. */
  chain: Array<{ id: string; node: N }>;
}

export interface CompactOptions<N> {
  isFolder: (node: N) => boolean;
  /** Ids that end a chain even when they have a single folder child. */
  stopAt?: ReadonlySet<string>;
}

/**
 * Rows in display order: a node's children follow it when it is expanded and they are known.
 * With `compact`, an expanded folder whose only child is a folder shares a row with it (`a/b/c`); top-level nodes never start a chain.
 */
export function visibleRows<N>(
  roots: N[],
  childrenOf: (id: string) => N[] | undefined,
  expanded: Set<string>,
  idOf: (node: N) => string,
  compact?: CompactOptions<N>,
): TreeRow<N>[] {
  const rows: TreeRow<N>[] = [];
  const walk = (nodes: N[], depth: number, parentId: string | null) => {
    for (const first of nodes) {
      const chain = [{ id: idOf(first), node: first }];
      let last = chain[0];
      while (compact && depth > 0 && expanded.has(last.id) && !compact.stopAt?.has(last.id)) {
        const kids = childrenOf(last.id);
        if (kids?.length !== 1 || !compact.isFolder(kids[0])) break;
        last = { id: idOf(kids[0]), node: kids[0] };
        chain.push(last);
      }
      rows.push({ node: last.node, depth, id: last.id, parentId, chain });
      if (!expanded.has(last.id)) continue;
      const children = childrenOf(last.id);
      if (children) walk(children, depth + 1, last.id);
    }
  };
  walk(roots, 0, null);
  return rows;
}

/** The row holding `id` (as its node or a chain segment) and the segment's index in the chain. */
export function locate<N>(rows: TreeRow<N>[], id: string): { row: TreeRow<N>; index: number } | undefined {
  for (const row of rows) {
    const index = row.chain.findIndex((c) => c.id === id);
    if (index >= 0) return { row, index };
  }
  return undefined;
}

const indexOf = <N>(rows: TreeRow<N>[], id: string) => rows.findIndex((r) => r.id === id);

export function nextId<N>(rows: TreeRow<N>[], id: string): string | null {
  const i = indexOf(rows, id);
  return i < 0 ? null : (rows[i + 1]?.id ?? null);
}

export function prevId<N>(rows: TreeRow<N>[], id: string): string | null {
  const i = indexOf(rows, id);
  return i <= 0 ? null : rows[i - 1].id;
}

export function parentId<N>(rows: TreeRow<N>[], id: string): string | null {
  return rows.find((r) => r.id === id)?.parentId ?? null;
}

/** The first visible child; null when the row is collapsed, its children aren't loaded or it has none. */
export function firstChildId<N>(rows: TreeRow<N>[], id: string): string | null {
  const i = indexOf(rows, id);
  const next = i < 0 ? undefined : rows[i + 1];
  return next && next.parentId === id ? next.id : null;
}

/** `id` is `ancestor` or one of its visible descendants; ids may be chain segments, a segment is inside the ones before it. */
export function isInside<N>(rows: TreeRow<N>[], id: string, ancestor: string): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const start = locate(rows, id);
  if (!start) return id === ancestor;
  if (start.row.chain.slice(0, start.index + 1).some((c) => c.id === ancestor)) return true;
  for (let cur = start.row.parentId; cur !== null; cur = byId.get(cur)?.parentId ?? null) {
    const row = byId.get(cur);
    if (row?.chain.some((c) => c.id === ancestor)) return true;
  }
  return false;
}

/** The given ids plus every descendant id reachable through `childrenOf`. */
export function subtreeIds<N>(
  ids: string[],
  childrenOf: (id: string) => N[] | undefined,
  idOf: (node: N) => string,
): string[] {
  const out: string[] = [];
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const child of childrenOf(id) ?? []) stack.push(idOf(child));
  }
  return out;
}
