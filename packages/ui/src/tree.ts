/**
 * Visible rows of a TreeView. Pure functions over the roots, a children lookup and the set of
 * expanded ids, so keyboard moves are easy to test. Generic over the node type N.
 */

export interface TreeRow<N> {
  node: N;
  depth: number;
  id: string;
  /** null for a top-level row. */
  parentId: string | null;
}

/** Rows in display order: a node's children follow it when it is expanded and they are known. */
export function visibleRows<N>(
  roots: N[],
  childrenOf: (id: string) => N[] | undefined,
  expanded: Set<string>,
  idOf: (node: N) => string,
): TreeRow<N>[] {
  const rows: TreeRow<N>[] = [];
  const walk = (nodes: N[], depth: number, parentId: string | null) => {
    for (const node of nodes) {
      const id = idOf(node);
      rows.push({ node, depth, id, parentId });
      if (!expanded.has(id)) continue;
      const children = childrenOf(id);
      if (children) walk(children, depth + 1, id);
    }
  };
  walk(roots, 0, null);
  return rows;
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

/** `id` is `ancestor` or one of its visible descendants. */
export function isInside<N>(rows: TreeRow<N>[], id: string, ancestor: string): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (let cur: string | null = id; cur !== null; cur = byId.get(cur)?.parentId ?? null) {
    if (cur === ancestor) return true;
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
