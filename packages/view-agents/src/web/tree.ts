import { STATUS_CATEGORY, type AgentPin, type AgentProject, type AgentSessionView, type AgentStatus, type AgentTree } from '../protocol.ts';

/** The key of a project: its picked path, slash-normalised and lowercased (as `server/projects.ts` `projectKey`). */
export const projectKey = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const folderNodeKey = (id: string) => `folder:${id}`;
export const projectNodeKey = (key: string) => `project:${key}`;

const byLabel = (label: (key: string) => string) => (a: string, b: string) => {
  const la = label(a);
  const lb = label(b);
  const ia = la.toLowerCase();
  const ib = lb.toLowerCase();
  return ia < ib ? -1 : ia > ib ? 1 : la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** Folders keep their present members in stored order (empty ones still returned); the top level gets the stored order first, then the rest in `order`. */
export function arrangeContainers(tree: AgentTree, present: string[], order: (a: string, b: string) => number): { folders: Array<{ id: string; keys: string[] }>; top: string[] } {
  const here = new Set(present);
  const inFolder = new Set(tree.folders.flatMap((f) => f.projects));
  const folders = tree.folders.map((f) => ({ id: f.id, keys: f.projects.filter((k) => here.has(k)) }));
  const top = tree.topOrder.filter((k) => here.has(k) && !inFolder.has(k));
  const seen = new Set(top);
  const rest = present.filter((k) => !inFolder.has(k) && !seen.has(k)).sort(order);
  return { folders, top: [...top, ...rest] };
}

interface Orderable {
  id: string;
  status: AgentStatus;
  updatedAt: number;
  pin?: AgentPin;
}

const RANK = { error: 0, waiting: 1, running: 2, idle: 3, stopped: 4 } as const;
const newest = <T extends Orderable>(a: T, b: T) => b.updatedAt - a.updatedAt;

/** The order a project shows its sessions in (port of `server/tree.ts` `orderSessions`): pins hold top/bottom, `stored` is the manual order, id-less sessions first. */
export function orderSessions<T extends Orderable>(sessions: T[], sort: AgentTree['sort'], stored: string[] = []): T[] {
  const top = sessions.filter((s) => s.pin === 'top').sort(newest);
  const bottom = sessions.filter((s) => s.pin === 'bottom').sort(newest);
  const rest = sessions.filter((s) => s.pin !== 'top' && s.pin !== 'bottom');
  let mid: T[];
  if (sort === 'recent') mid = rest.sort(newest);
  else if (sort === 'actionable') mid = rest.sort((a, b) => RANK[STATUS_CATEGORY[a.status]] - RANK[STATUS_CATEGORY[b.status]] || newest(a, b));
  else {
    const withId = rest.filter((s) => !!s.id);
    const byId = new Map(withId.map((s) => [s.id, s]));
    const known = stored.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    const inStored = new Set(stored);
    const added = withId.filter((s) => !inStored.has(s.id)).sort(newest);
    mid = [...rest.filter((s) => !s.id).sort(newest), ...added, ...known];
  }
  return [...top, ...mid, ...bottom];
}

/** Running (incl. Starting) or Waiting, excluding finished-unseen (Done). */
export const isActive = (s: AgentSessionView) => s.status === 'running' || s.status === 'starting' || s.status === 'needs-you';

export type TreeRow =
  | { kind: 'folder'; id: string; name: string; depth: number; collapsed: boolean; sessions: AgentSessionView[]; projectIds: string[]; displayed: string[] }
  | { kind: 'project'; project: AgentProject; key: string; /** Collapse node: `key`, or `<key>\u0000<account id>` when split. */ node: string; /** Account part of a split node's label. */ suffix?: string; depth: number; collapsed: boolean; folder?: string; sessions: AgentSessionView[]; displayed: string[] }
  | { kind: 'session'; session: AgentSessionView; projectKey: string; depth: number; last: boolean; displayed: string[] }
  | { kind: 'divider' };

export interface BuildInput {
  tree: AgentTree;
  projects: AgentProject[];
  /** The visible live sessions (after search and filters), each with a known `project` id. */
  sessions: AgentSessionView[];
  /** Search or filters active: nodes without visible sessions are dropped, then folders left empty. */
  filtering: boolean;
  /** `ui.recentProjectsFirst`: newest activity first instead of alphabetical. */
  recentFirst?: boolean;
}

const NODE_SEP = '\u0000';

/**
 * A project's nodes over its ordered sessions: one per session `node` (split per owner account when `shareProjects` is off),
 * the unsplit one first, the split ones adjacent and sorted by account label; a project without sessions keeps one node.
 */
/** The collapse node a session sits under: `key`, or `<key>\u0000<account id>` when its project is split. */
export const sessionNodeKey = (key: string, projectId: string, s: Pick<AgentSessionView, 'node'>): string => {
  const cut = s.node && s.node !== projectId ? s.node.indexOf(NODE_SEP) : -1;
  return cut < 0 ? key : `${key}${NODE_SEP}${s.node!.slice(cut + 1)}`;
};

export function projectNodes(key: string, projectId: string, list: AgentSessionView[]): Array<{ node: string; suffix?: string; list: AgentSessionView[] }> {
  const nodes = new Map<string, { node: string; suffix?: string; list: AgentSessionView[] }>();
  for (const s of list) {
    const cut = s.node && s.node !== projectId ? s.node.indexOf(NODE_SEP) : -1;
    const account = cut < 0 ? undefined : s.node!.slice(cut + 1);
    const node = account === undefined ? key : `${key}${NODE_SEP}${account}`;
    const at = nodes.get(node);
    if (at) at.list.push(s);
    else nodes.set(node, { node, suffix: account === undefined ? undefined : (s.nodeSuffix ?? account), list: [s] });
  }
  if (nodes.size === 0) return [{ node: key, list }];
  const label = byLabel((n) => nodes.get(n)!.suffix ?? '');
  return [...nodes.keys()].sort((a, b) => (a === key ? -1 : b === key ? 1 : label(a, b))).map((n) => nodes.get(n)!);
}

/** The sidebar rows: folders → projects → sessions, per the tree store (collapse, manual orders, pins, view). */
export function buildRows({ tree, projects, sessions, filtering, recentFirst }: BuildInput): TreeRow[] {
  const byKey = new Map<string, AgentProject>();
  for (const p of projects) {
    const k = projectKey(p.path);
    if (!byKey.has(k)) byKey.set(k, p);
  }
  const idToKey = new Map([...byKey].map(([k, p]) => [p.id, k]));
  const perKey = new Map<string, AgentSessionView[]>();
  for (const s of sessions) {
    const k = s.project !== undefined ? idToKey.get(s.project) : undefined;
    if (k === undefined) continue;
    const list = perKey.get(k);
    if (list) list.push(s);
    else perKey.set(k, [s]);
  }
  const ordered = new Map([...byKey.keys()].map((k) => [k, orderSessions(perKey.get(k) ?? [], tree.sort, tree.sessionOrder[k])]));
  const latest = (k: string) => Math.max(0, ...(perKey.get(k) ?? []).map((s) => s.updatedAt));
  const alpha = byLabel((k) => byKey.get(k)?.name ?? k);
  const order = recentFirst ? (a: string, b: string) => latest(b) - latest(a) || alpha(a, b) : alpha;
  const keep = (k: string) => !filtering || (ordered.get(k)?.length ?? 0) > 0;
  const arranged = arrangeContainers(tree, [...byKey.keys()], order);
  const collapsed = new Set(tree.collapsed);
  const names = new Map(tree.folders.map((f) => [f.id, f.name]));
  const folders = arranged.folders
    .map((f) => ({ id: f.id, keys: f.keys.filter(keep) }))
    .filter((f) => !filtering || f.keys.length > 0);
  const top = arranged.top.filter(keep);

  const projectRows = (keys: string[], depth: number, folder?: string): TreeRow[] => {
    const out: TreeRow[] = [];
    for (const key of keys) {
      const project = byKey.get(key)!;
      for (const n of projectNodes(key, project.id, ordered.get(key) ?? [])) {
        const shut = collapsed.has(projectNodeKey(n.node));
        out.push({ kind: 'project', project, key, node: n.node, suffix: n.suffix, depth, collapsed: shut, folder, sessions: n.list, displayed: keys });
        if (shut) continue;
        const ids = n.list.map((s) => s.id);
        n.list.forEach((s, i) => out.push({ kind: 'session', session: s, projectKey: key, depth: depth + 1, last: i === n.list.length - 1, displayed: ids }));
      }
    }
    return out;
  };
  const folderRows = (f: { id: string; keys: string[] }): TreeRow[] => {
    const shut = collapsed.has(folderNodeKey(f.id));
    const row: TreeRow = {
      kind: 'folder', id: f.id, name: names.get(f.id) ?? f.id, depth: 0, collapsed: shut,
      sessions: f.keys.flatMap((k) => ordered.get(k) ?? []), projectIds: f.keys.map((k) => byKey.get(k)!.id), displayed: folders.map((x) => x.id),
    };
    return [row, ...(shut ? [] : projectRows(f.keys, 1, f.id))];
  };

  if (tree.view !== 'active') return [...folders.flatMap(folderRows), ...projectRows(top, 0)];
  const activeKey = (k: string) => (ordered.get(k) ?? []).some(isActive);
  const hot = folders.filter((f) => f.keys.some(activeKey));
  const cold = folders.filter((f) => !f.keys.some(activeKey));
  const hotTop = top.filter(activeKey);
  const coldTop = top.filter((k) => !activeKey(k));
  const head = [...hot.flatMap(folderRows), ...projectRows(hotTop, 0)];
  const tail = [...cold.flatMap(folderRows), ...projectRows(coldTop, 0)];
  return head.length && tail.length ? [...head, { kind: 'divider' }, ...tail] : [...head, ...tail];
}

/** A new folder's name: whitespace runs collapsed, ends trimmed ('' = create nothing). */
export const folderName = (name: string): string => name.replace(/\s+/g, ' ').trim();

/** A comma-separated tags input: each part trimmed, blanks and repeats dropped. */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const part of input.split(',')) {
    const tag = part.trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The TAGS section: each distinct tag with the number of sessions carrying it, sorted case-insensitively then exactly. */
export function tagCounts(sessions: Array<{ tags?: string[] }>): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of sessions) for (const tag of new Set(s.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const label = byLabel((k) => k);
  return [...counts.keys()].sort(label).map((tag) => ({ tag, count: counts.get(tag)! }));
}

/** Next pin in the cycle none → top → bottom → none. */
export const nextPin = (pin: AgentPin | undefined): AgentPin | undefined => (pin === undefined ? 'top' : pin === 'top' ? 'bottom' : undefined);

/** What ← does on `rows[i]`: collapse an expanded folder/project, else the nearest folder or shallower project above (none at depth 0). */
export type LeftAction = { kind: 'collapse' } | { kind: 'move'; to: number } | undefined;

export function leftAction(rows: readonly TreeRow[], i: number): LeftAction {
  const r = rows[i];
  if (!r || r.kind === 'divider') return undefined;
  if (r.kind !== 'session' && !r.collapsed) return { kind: 'collapse' };
  if (r.depth === 0) return undefined;
  for (let j = i - 1; j >= 0; j--) {
    const p = rows[j]!;
    if (p.kind !== 'session' && p.kind !== 'divider' && p.depth < r.depth) return { kind: 'move', to: j };
  }
  return undefined;
}

/** What → does on `rows[i]`: expand a collapsed folder/project; on an expanded one, the very next row when it is selectable. */
export type RightAction = { kind: 'expand' } | { kind: 'move'; to: number } | undefined;

export function rightAction(rows: readonly TreeRow[], i: number): RightAction {
  const r = rows[i];
  if (!r || r.kind === 'divider' || r.kind === 'session') return undefined;
  if (r.collapsed) return { kind: 'expand' };
  const next = rows[i + 1];
  return next && next.kind !== 'divider' ? { kind: 'move', to: i + 1 } : undefined;
}

/** Index in `rows` of the n-th selectable (non-divider) row. */
export function selectableToRow(rows: readonly TreeRow[], n: number): number {
  let k = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.kind !== 'divider' && ++k === n) return i;
  }
  return -1;
}

/** Position among the selectable rows of `rows[i]`. */
export const rowToSelectable = (rows: readonly TreeRow[], i: number): number => rows.slice(0, i).filter((r) => r.kind !== 'divider').length;
