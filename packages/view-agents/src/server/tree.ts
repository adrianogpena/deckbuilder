import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';
import { STATUS_CATEGORY, type AgentPin, type AgentStatus, type AgentTree, type AgentTreeFolder, type AgentTreePatch } from '../protocol.ts';

export const emptyTree = (): AgentTree => ({ folders: [], topOrder: [], sessionOrder: {}, collapsed: [], sort: 'manual', view: 'normal' });

/** A random 8-hex-character folder id. */
export const newFolderId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

const strings = (v: unknown): string[] => {
  const out: string[] = [];
  if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && !out.includes(x)) out.push(x);
  return out;
};

/** Reads a stored tree: bad entries are dropped, unknown values fall back to defaults, a project stays in its first folder only. */
export function normalizeTree(raw: unknown): AgentTree {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const tree = emptyTree();
  const inFolder = new Set<string>();
  if (Array.isArray(o.folders)) {
    const ids = new Set<string>();
    for (const f of o.folders as unknown[]) {
      const r = f as { id?: unknown; name?: unknown; projects?: unknown } | null;
      if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim() || ids.has(r.id)) continue;
      ids.add(r.id);
      const projects = strings(r.projects).filter((k) => !inFolder.has(k));
      for (const k of projects) inFolder.add(k);
      tree.folders.push({ id: r.id, name: r.name.trim(), projects });
    }
  }
  tree.topOrder = strings(o.topOrder).filter((k) => !inFolder.has(k));
  if (o.sessionOrder && typeof o.sessionOrder === 'object' && !Array.isArray(o.sessionOrder)) {
    for (const [k, v] of Object.entries(o.sessionOrder)) {
      const ids = strings(v);
      if (ids.length) tree.sessionOrder[k] = ids;
    }
  }
  tree.collapsed = strings(o.collapsed);
  tree.sort = o.sort === 'recent' || o.sort === 'actionable' ? o.sort : 'manual';
  tree.view = o.view === 'active' ? 'active' : 'normal';
  return tree;
}

const byLabel = (label: (key: string) => string) => (a: string, b: string) => {
  const la = label(a);
  const lb = label(b);
  const ia = la.toLowerCase();
  const ib = lb.toLowerCase();
  return ia < ib ? -1 : ia > ib ? 1 : la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** Folders keep their present members in stored order (empty ones still returned); the top level gets the stored order first, then the rest alphabetically. */
export function arrangeContainers(tree: AgentTree, present: string[], label: (key: string) => string = (k) => k): { folders: Array<{ id: string; keys: string[] }>; top: string[] } {
  const here = new Set(present);
  const inFolder = new Set(tree.folders.flatMap((f) => f.projects));
  const folders = tree.folders.map((f) => ({ id: f.id, keys: f.projects.filter((k) => here.has(k)) }));
  const top = tree.topOrder.filter((k) => here.has(k) && !inFolder.has(k));
  const seen = new Set(top);
  const rest = present.filter((k) => !inFolder.has(k) && !seen.has(k)).sort(byLabel(label));
  return { folders, top: [...top, ...rest] };
}

const NODE_SEP = '\u0000';

/** Tree node key of a project: the project key, or (account split, `shareProjects` off) `<project key>\0<account id>`. */
export const nodeKeyOf = (project: string, account?: string): string => (account === undefined ? project : `${project}${NODE_SEP}${account}`);

/** The project key (the shared preferences entry) of a node key. */
export const projectKeyOf = (node: string): string => node.split(NODE_SEP)[0]!;

export interface OwnerAccount {
  id: string;
  isDefault: boolean;
  email?: string;
}

export interface OwnerView {
  /** Config dir of the active account (the default's, when "" or unknown), resolved by the caller. */
  active: OwnerAccount | undefined;
  showAllSessions: boolean;
  shareProjects: boolean;
  showOwner: boolean;
}

const nodeSuffixOf = (a: OwnerAccount | undefined, id: string): string => a?.email ?? (a?.isDefault ? 'default' : id);

/**
 * Applies the account view to project sessions: hides those owned by other accounts when `showAllSessions` is off, gives each the
 * node key (split per owner when `shareProjects` is off), and marks `foreign` / `owner` when several accounts exist.
 */
export function applyAccountView<T extends { account: string; project?: string }>(
  sessions: T[],
  accounts: OwnerAccount[],
  view: OwnerView,
): Array<T & { node?: string; nodeSuffix?: string; foreign?: true; owner?: string }> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const many = accounts.length > 1;
  const out: Array<T & { node?: string; nodeSuffix?: string; foreign?: true; owner?: string }> = [];
  for (const s of sessions) {
    const mine = !view.active || s.account === view.active.id;
    if (!mine && !view.showAllSessions) continue;
    const owner = byId.get(s.account);
    const x: T & { node?: string; nodeSuffix?: string; foreign?: true; owner?: string } = { ...s };
    if (s.project !== undefined) {
      x.node = nodeKeyOf(s.project, view.shareProjects ? undefined : s.account);
      if (!view.shareProjects) x.nodeSuffix = nodeSuffixOf(owner, s.account);
    }
    if (many && !mine) {
      x.foreign = true;
      if (view.showOwner) x.owner = owner?.email ? owner.email.split('@')[0]! : s.account;
    }
    out.push(x);
  }
  return out;
}

/** Expands ordered project keys into nodes: a split project's nodes sit together, sorted by account label (unsplit = one node). */
export function projectNodes(order: string[], sessions: Array<{ project?: string; node?: string; account: string; nodeSuffix?: string }>): Array<{ node: string; project: string; account?: string; suffix?: string }> {
  const out: Array<{ node: string; project: string; account?: string; suffix?: string }> = [];
  for (const project of order) {
    const split = new Map<string, { node: string; project: string; account: string; suffix: string }>();
    for (const s of sessions) {
      if (s.project === project && s.node !== undefined && s.node !== project && !split.has(s.node)) split.set(s.node, { node: s.node, project, account: s.account, suffix: s.nodeSuffix ?? s.account });
    }
    if (!split.size) out.push({ node: project, project });
    else out.push(...[...split.values()].sort((a, b) => a.suffix.toLowerCase().localeCompare(b.suffix.toLowerCase()) || a.node.localeCompare(b.node)));
  }
  return out;
}

export interface OrderableSession {
  id: string;
  status: AgentStatus;
  updatedAt: number;
  pin?: AgentPin;
  /** No session id known yet (a new session still starting). */
  idless?: boolean;
  /** An id-less session started here just now ("pending top"). */
  pending?: boolean;
}

const RANK = { error: 0, waiting: 1, running: 2, idle: 3, stopped: 4 } as const;
const newest = <T extends OrderableSession>(a: T, b: T) => b.updatedAt - a.updatedAt;

/** The order a project shows its sessions in. Pinned ones hold top/bottom; `stored` is the project's manual order. */
export function orderSessions<T extends OrderableSession>(sessions: T[], sort: AgentTree['sort'], stored: string[] = []): T[] {
  const top = sessions.filter((s) => s.pin === 'top').sort(newest);
  const bottom = sessions.filter((s) => s.pin === 'bottom').sort(newest);
  const rest = sessions.filter((s) => s.pin !== 'top' && s.pin !== 'bottom');
  let mid: T[];
  if (sort === 'recent') mid = rest.sort(newest);
  else if (sort === 'actionable') mid = rest.sort((a, b) => RANK[STATUS_CATEGORY[a.status]] - RANK[STATUS_CATEGORY[b.status]] || newest(a, b));
  else {
    const withId = rest.filter((s) => !s.idless);
    const byId = new Map(withId.map((s) => [s.id, s]));
    const known = stored.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    const inStored = new Set(stored);
    const added = withId.filter((s) => !inStored.has(s.id)).sort(newest);
    const idless = rest.filter((s) => s.idless);
    mid = [...idless.sort(newest), ...added, ...known];
  }
  return [...top, ...mid, ...bottom];
}

/** Records the order each displayed project shows: only missing ids are appended. Returns the same tree when nothing changed. */
export function freezeOrders(tree: AgentTree, shown: Record<string, string[]>): AgentTree {
  let order = tree.sessionOrder;
  for (const [key, ids] of Object.entries(shown)) {
    const cur = order[key] ?? [];
    const have = new Set(cur);
    const missing = ids.filter((id) => id && !have.has(id) && have.add(id));
    if (!missing.length) continue;
    if (order === tree.sessionOrder) order = { ...order };
    order[key] = [...missing, ...cur];
  }
  return order === tree.sessionOrder ? tree : { ...tree, sessionOrder: order };
}

/** A new session goes first in its project's stored order (an earlier occurrence is removed). */
export function putSessionFirst(tree: AgentTree, key: string, id: string): AgentTree {
  if (!id) return tree;
  return { ...tree, sessionOrder: { ...tree.sessionOrder, [key]: [id, ...(tree.sessionOrder[key] ?? []).filter((x) => x !== id)] } };
}

/** `/clear` id change: in manual mode the new id goes directly before the old one (first when the old one is not stored). */
export function replaceClearedId(tree: AgentTree, key: string, oldId: string, newId: string): AgentTree {
  if (tree.sort !== 'manual' || !newId || oldId === newId) return tree;
  const cur = (tree.sessionOrder[key] ?? []).filter((x) => x !== newId);
  const at = cur.indexOf(oldId);
  const next = at < 0 ? [newId, ...cur] : [...cur.slice(0, at), newId, ...cur.slice(at)];
  return { ...tree, sessionOrder: { ...tree.sessionOrder, [key]: next } };
}

/** Swaps `key` with its displayed neighbour in `stored`; null when it is a no-op (not displayed, or past either end). */
export function swapDisplayed(stored: string[], displayed: string[], key: string, dir: -1 | 1): string[] | null {
  const at = displayed.indexOf(key);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= displayed.length) return null;
  const list = [...stored];
  for (const k of displayed) if (!list.includes(k)) list.push(k);
  const shown = new Set(displayed);
  const slots = list.map((k, i) => (shown.has(k) ? i : -1)).filter((i) => i >= 0);
  const from = slots.findIndex((i) => list[i] === key);
  const other = slots[from + dir];
  if (from < 0 || other === undefined) return null;
  const i = slots[from]!;
  [list[i], list[other]] = [list[other]!, list[i]!];
  return list;
}

/** Folder move: swap with the immediate neighbour; null at either end. */
export function moveFolder(tree: AgentTree, id: string, dir: -1 | 1): AgentTree | null {
  const at = tree.folders.findIndex((f) => f.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= tree.folders.length) return null;
  const folders = [...tree.folders];
  [folders[at], folders[to]] = [folders[to]!, folders[at]!];
  return { ...tree, folders };
}

/** Project move inside its container (a folder, or the top level when `folder` is undefined). */
export function moveProject(tree: AgentTree, key: string, dir: -1 | 1, displayed: string[], folder?: string): AgentTree | null {
  if (folder === undefined) {
    const topOrder = swapDisplayed(tree.topOrder, displayed, key, dir);
    return topOrder && { ...tree, topOrder };
  }
  const f = tree.folders.find((x) => x.id === folder);
  const projects = f && swapDisplayed(f.projects, displayed, key, dir);
  return projects ? { ...tree, folders: tree.folders.map((x): AgentTreeFolder => (x.id === folder ? { ...x, projects } : x)) } : null;
}

/** Session move: the displayed-neighbour swap on the project's stored session order. */
export function moveSession(tree: AgentTree, project: string, id: string, dir: -1 | 1, displayed: string[]): AgentTree | null {
  if (!id) return null;
  const next = swapDisplayed(tree.sessionOrder[project] ?? [], displayed, id, dir);
  return next ? { ...tree, sessionOrder: { ...tree.sessionOrder, [project]: next } } : null;
}

/** Removes a folder and its collapse key (other keys are never pruned). Hook for the folders CRUD step. */
export function removeFolderState(tree: AgentTree, id: string): AgentTree {
  return { ...tree, folders: tree.folders.filter((f) => f.id !== id), collapsed: tree.collapsed.filter((k) => k !== `folder:${id}`) };
}

/** Appends a folder named `name` (whitespace runs collapsed, ends trimmed); null for a blank name. */
export function createFolder(tree: AgentTree, name: string): AgentTree | null {
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n) return null;
  let id = newFolderId();
  while (tree.folders.some((f) => f.id === id)) id = newFolderId();
  return { ...tree, folders: [...tree.folders, { id, name: n, projects: [] }] };
}

/** Renames (trimmed at the ends only; duplicates allowed); null for a blank name or unknown folder. */
export function renameFolder(tree: AgentTree, id: string, name: string): AgentTree | null {
  const n = name.trim();
  if (!n || !tree.folders.some((f) => f.id === id)) return null;
  return { ...tree, folders: tree.folders.map((f): AgentTreeFolder => (f.id === id ? { ...f, name: n } : f)) };
}

/** Deletes a folder: its members go to the front of the top-level order (folder order), the collapse key goes. */
export function deleteFolder(tree: AgentTree, id: string): AgentTree | null {
  const f = tree.folders.find((x) => x.id === id);
  if (!f) return null;
  const next = removeFolderState(tree, id);
  const members = new Set(f.projects);
  return { ...next, topOrder: [...f.projects, ...next.topOrder.filter((k) => !members.has(k))] };
}

/** Moves projects (distinct keys, given order) out of every folder and the top order, then appends them to the target folder or the top order. Missing target folder = null. */
export function moveToFolder(tree: AgentTree, keys: string[], folder?: string): AgentTree | null {
  if (folder !== undefined && !tree.folders.some((f) => f.id === folder)) return null;
  const moved = strings(keys);
  if (!moved.length) return null;
  const gone = new Set(moved);
  const folders = tree.folders.map((f): AgentTreeFolder => {
    const rest = f.projects.filter((k) => !gone.has(k));
    return f.id === folder ? { ...f, projects: [...rest, ...moved] } : { ...f, projects: rest };
  });
  const rest = tree.topOrder.filter((k) => !gone.has(k));
  return { ...tree, folders, topOrder: folder === undefined ? [...rest, ...moved] : rest };
}

export type TreeChangeResult = { ok: true; tree: AgentTree } | { ok: false; error: 'activeView' | 'noop' | 'invalid'; tree: AgentTree };

/** Applies one `PATCH /api/agents/tree` body as a function of the tree. All reorders are refused in the active view. */
export function applyTreePatch(tree: AgentTree, patch: AgentTreePatch): TreeChangeResult {
  const fail = (error: 'activeView' | 'noop' | 'invalid'): TreeChangeResult => ({ ok: false, error, tree });
  const p = patch as Record<string, any>;
  if (p.collapse) {
    const { key, collapsed } = p.collapse;
    if (typeof key !== 'string' || !key) return fail('invalid');
    const rest = tree.collapsed.filter((k) => k !== key);
    return { ok: true, tree: { ...tree, collapsed: collapsed ? [...rest, key] : rest } };
  }
  if (p.sort !== undefined) return p.sort === 'manual' || p.sort === 'recent' || p.sort === 'actionable' ? { ok: true, tree: { ...tree, sort: p.sort } } : fail('invalid');
  if (p.view !== undefined) return p.view === 'normal' || p.view === 'active' ? { ok: true, tree: { ...tree, view: p.view } } : fail('invalid');
  if (p.freeze && typeof p.freeze === 'object') {
    const shown: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(p.freeze)) {
      const key = projectKeyOf(k);
      shown[key] = strings([...(shown[key] ?? []), ...strings(v)]);
    }
    return { ok: true, tree: freezeOrders(tree, shown) };
  }
  if (p.newSession) {
    const { project, id } = p.newSession;
    return typeof project === 'string' && typeof id === 'string' && id ? { ok: true, tree: putSessionFirst(tree, projectKeyOf(project), id) } : fail('invalid');
  }
  if (p.clearedId) {
    const { project, oldId, newId } = p.clearedId;
    return [project, oldId, newId].every((x) => typeof x === 'string') ? { ok: true, tree: replaceClearedId(tree, projectKeyOf(project), oldId, newId) } : fail('invalid');
  }
  const folderOp = (next: AgentTree | null): TreeChangeResult => (next ? { ok: true, tree: next } : fail('noop'));
  if (p.folderCreate) return typeof p.folderCreate.name === 'string' ? folderOp(createFolder(tree, p.folderCreate.name)) : fail('invalid');
  if (p.folderRename) return typeof p.folderRename.id === 'string' && typeof p.folderRename.name === 'string' ? folderOp(renameFolder(tree, p.folderRename.id, p.folderRename.name)) : fail('invalid');
  if (p.folderDelete) return typeof p.folderDelete.id === 'string' ? folderOp(deleteFolder(tree, p.folderDelete.id)) : fail('invalid');
  if (p.moveToFolder) {
    const { keys, folder } = p.moveToFolder;
    if (!Array.isArray(keys) || (folder !== undefined && typeof folder !== 'string')) return fail('invalid');
    return folderOp(moveToFolder(tree, keys.filter((k: unknown): k is string => typeof k === 'string').map(projectKeyOf), folder));
  }
  const m = p.move;
  if (m && typeof m === 'object') {
    if (tree.view === 'active') return fail('activeView');
    if (m.dir !== -1 && m.dir !== 1) return fail('invalid');
    const next =
      m.kind === 'folder' ? moveFolder(tree, String(m.id), m.dir)
      : m.kind === 'project' ? moveProject(tree, projectKeyOf(String(m.key)), m.dir, strings(strings(m.displayed).map(projectKeyOf)), typeof m.folder === 'string' ? m.folder : undefined)
      : m.kind === 'session' ? moveSession(tree, projectKeyOf(String(m.project)), String(m.id), m.dir, strings(m.displayed))
      : undefined;
    if (next === undefined) return fail('invalid');
    return next ? { ok: true, tree: next } : fail('noop');
  }
  return fail('invalid');
}

export interface TreeStore {
  read(): Promise<AgentTree>;
  /** Re-reads the file, applies `fn` to the tree on disk and writes atomically (only when it changed). Calls are serialised. */
  update(fn: (tree: AgentTree) => AgentTree): Promise<AgentTree>;
  patch(patch: AgentTreePatch): Promise<TreeChangeResult>;
}

/** The tree kept in `file`; a file that isn't a JSON object is renamed to `<file>.corrupt-<time>` by `readJsonFile`. */
export function createTreeStore(file: string): TreeStore {
  let tail: Promise<unknown> = Promise.resolve();
  const read = async () => {
    const raw = await readJsonFile(file, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
    return { tree: normalizeTree(raw), text: raw === undefined ? '' : JSON.stringify(normalizeTree(raw)) };
  };
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.catch(() => {}).then(job);
    tail = run;
    return run;
  };
  const commit = async (fn: (tree: AgentTree) => AgentTree) => {
    const cur = await read();
    const next = fn(cur.tree);
    if (next !== cur.tree && JSON.stringify(next) !== cur.text) await writeJsonAtomic(file, next);
    return next;
  };
  return {
    read: () => serial(async () => (await read()).tree),
    update: (fn) => serial(() => commit(fn)),
    patch: (patch) =>
      serial(async () => {
        let result: TreeChangeResult | undefined;
        const tree = await commit((t) => {
          result = applyTreePatch(t, patch);
          return result.tree;
        });
        return result ? { ...result, tree } : { ok: false, error: 'invalid', tree };
      }),
  };
}
