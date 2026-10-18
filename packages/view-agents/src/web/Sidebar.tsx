import { type CSSProperties, type DragEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, type ContextMenuItem, fuzzyScore, highlightRuns, KEY_SCOPE_ATTR, useCommand, useDialogs, useRovingList, useToast } from '@deckbuilderkit/ui';
import { AGENTS_LIST_SCOPE, agentsCommands } from '../commands';
import { t } from '../i18n';
import type { AgentCategory } from '../protocol.ts';
import { type AgentAccountUsage, type AgentProject, type AgentSessionView, type AgentStatus, type AgentTreePatch, addTags, deleteSession, deleteSessions, markSeen, markUnread, patchSessionState, trashMessage, undoDelete, removeTagEverywhere, searchSessions, stopSession, type TreePatchResult } from './api';
import { compareSessions, displayName, statusCounts } from './attention';
import { type BatchAction, BatchBar } from './BatchBar';
import { archiveOutcome, batchOrder, distinctKeys, isWorking, liveHere, partitionArchive, stopOutcome, toggleChecked } from './batch';
import { type AgentFilters, CATEGORIES, categoryOf, clearFilters, clearStatus, isFiltering, matchesFilters, NO_FILTERS, nextTime, parseQuery, STATUS_KEYS, type TimeMode, type TitleLabels, titleNote, toggleStatus, toggleTag } from './filters';
import { type FolderPick, MoveToFolder } from './MoveToFolder';
import { AccountPicker, activeDirOf } from './AccountPicker';
import { type AddedAccount, ManageAccounts, type ManageAccountsMode } from './ManageAccounts';
import { setActiveAccount } from './api';
import { pruneBatch, rowKey, shownOrders, startedCandidates, stepStarted, trackPrevious, reselect, type PreviousState } from './navigation';
import { TrashPanel } from './TrashPanel';
import { type GitStatusMap, projectGitBadge } from './git';
import { buildRows, folderName, folderNodeKey, leftAction, nextPin, parseTags, projectKey, projectNodeKey, rightAction, rowToSelectable, sessionNodeKey, tagCounts, type TreeRow } from './tree';
import { useAgentTree } from './useAgentSessions';
import { type UsageSettings, UsageView, usageViewData } from './UsageView';
import { severity } from './usage-format';

const depthStyle = (depth: number) => ({ '--agents-depth': depth }) as CSSProperties;

/** What a drag carries: a node of one container (folders, a folder's projects, the top level, or a project's sessions). */
interface DragNode {
  container: string;
  id: string;
}

export interface SidebarProps {
  projects: AgentProject[];
  sessions: AgentSessionView[];
  /** Plan usage per account; accounts without known rate limits are absent. */
  usage?: AgentAccountUsage[];
  /** `agents.usage.*` settings: the usage section and the context % of live rows show only when `show`. */
  usageSettings?: UsageSettings;
  /** A click on the usage section. */
  onOpenUsage?(): void;
  /** Git status per session cwd (latest `git` frame); project rows show a worst-case badge. */
  git?: GitStatusMap;
  selectedId?: string;
  onSelect(sessionId: string): void;
  /** The selected project row, if any (its summary is on screen). */
  selectedProjectId?: string;
  /** A click on a project's name; called with the project id. */
  onSelectProject?(projectId: string): void;
  /** The selected folder row, if any (its summary is on screen). */
  selectedFolderId?: string;
  /** A click on a folder's name: its id, name and the ids of its displayed projects. */
  onSelectFolder?(folder: { id: string; name: string; projectIds: string[] }): void;
  /** The live sessions the groups show after search and filters, on each change. */
  onVisibleChange?(sessions: AgentSessionView[]): void;
  /** Called with the project id. */
  onNewSession(projectId: string): void;
  /** `N` on a project or session row: start there with the active account, no form. */
  onQuickNew(projectId: string): void;
  onRemoveProject(projectId: string): void;
  /** Context menu actions on a session (plain items, no keybindings). */
  onStop?(session: AgentSessionView): void;
  onRestart?(session: AgentSessionView): void;
  onStartBackground?(session: AgentSessionView): void;
  /** `ui.expandCollapsedOnActiveJump` (not in Settings yet; off by default): `[` / `]` also land on rows inside collapsed nodes. */
  expandCollapsedOnActiveJump?: boolean;
}

const SORTS = ['manual', 'recent', 'actionable'] as const;

const ITEMS = '.agents-tree .agents-session, .agents-tree .agents-node';

export function statusLabel(s: AgentStatus): string {
  switch (s) {
    case 'error': return t('agents.status.error');
    case 'needs-you': return t('agents.status.needs-you');
    case 'running': return t('agents.status.running');
    case 'done': return t('agents.status.done');
    case 'idle': return t('agents.status.idle');
    case 'starting': return t('agents.status.starting');
    case 'exited': return t('agents.status.exited');
    default: return t('agents.status.stopped');
  }
}

/** Compact token count: 950, 12.3k, 1.2M. */
export function compactTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** The status glyph of a row (sdeck look); its colour comes from the status class. */
export const STATUS_GLYPH: Record<AgentStatus, string> = {
  running: '●', 'needs-you': '◐', done: '✓', idle: '○', starting: '⟳', error: '✕', exited: '✕', stopped: '■',
};

/** The context % of a row and its token breakdown tooltip; undefined when the context is unknown. */
function sessionUsage(s: AgentSessionView): { line: string; title: string } | undefined {
  if (s.contextPercent === undefined) return undefined;
  const lines: string[] = [`${t('agents.context')}: ${s.contextPercent}%`];
  const tk = s.tokens;
  if (tk) {
    const fmt = (n: number) => n.toLocaleString();
    lines.push(
      `${t('agents.tokens.input')}: ${fmt(tk.input)}`,
      `${t('agents.tokens.output')}: ${fmt(tk.output)}`,
      `${t('agents.tokens.cacheCreation')}: ${fmt(tk.cacheCreation)}`,
      `${t('agents.tokens.cacheRead')}: ${fmt(tk.cacheRead)}`,
    );
  }
  return { line: `${s.contextPercent}%`, title: lines.join('\n') };
}

/** Pill glyph and status class (colour) per category; the done-unseen pill sits after waiting. */
function timeLabel(mode: TimeMode): string {
  switch (mode) {
    case 'today': return t('agents.time.today');
    case '3d': return t('agents.time.3d');
    case '7d': return t('agents.time.7d');
    default: return t('agents.time.all');
  }
}

const TITLE_LABELS: TitleLabels = {
  selected: (count) => t('agents.note.selected', { count: String(count) }),
  get archived() { return t('agents.note.archived'); },
  get filtered() { return t('agents.note.filtered'); },
  get actionable() { return t('agents.note.actionable'); },
  get activeOnTop() { return t('agents.note.activeOnTop'); },
};

const CATEGORY_PILL: Record<AgentCategory, { glyph: string; status: AgentStatus }> = {
  running: { glyph: '●', status: 'running' },
  waiting: { glyph: '◐', status: 'needs-you' },
  idle: { glyph: '○', status: 'idle' },
  error: { glyph: '✕', status: 'error' },
  stopped: { glyph: '■', status: 'stopped' },
};

/** How a session matched the search: fuzzy name positions, or a full-text snippet. */
interface RowMatch {
  positions?: number[];
  snippet?: string;
}

/** Projects with their Claude sessions, a status dot and label per session; search, filter pills, pin, rename and archive. */
export function Sidebar({ projects, sessions, usage = [], usageSettings, onOpenUsage, git = {}, selectedId, onSelect, selectedProjectId, onSelectProject, selectedFolderId, onSelectFolder, onVisibleChange, onNewSession, onQuickNew, onRemoveProject, onStop, onRestart, onStartBackground, expandCollapsedOnActiveJump = false }: SidebarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const usageBlock = usageSettings?.show && (() => {
    const selected = sessions.find((x) => x.id === selectedId);
    const counts: Partial<Record<AgentCategory, number>> = {};
    for (const x of sessions) counts[categoryOf(x)] = (counts[categoryOf(x)] ?? 0) + 1;
    const withModel = selected?.modelName ? selected : [...sessions].filter((x) => x.modelName).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const data = usageViewData(withModel ?? selected, usage, sessions.map((x) => x.account), counts);
    return <UsageView {...data} items={usageSettings.items} compact={usageSettings.compact} use24h={usageSettings.use24h} onOpen={onOpenUsage} className={`pin-${usageSettings.position}`} />;
  })();
  useRovingList(ref, '.agents-session, .agents-node');
  const focusedList = useRef(false);
  // Letter keys and arrows only work with focus inside the list: put it on the current row once the tree has rows.
  useEffect(() => {
    if (focusedList.current) return;
    const root = ref.current;
    if (!root) return;
    const item = root.querySelector<HTMLElement>('.agents-tree [tabindex="0"]');
    if (!item && (sessions.length > 0 || projects.length > 0)) return;
    focusedList.current = true;
    if (!root.contains(document.activeElement)) (item ?? root).focus({ preventScroll: true });
  });
  const toast = useToast();
  const { tree, patch } = useAgentTree();
  const [drag, setDrag] = useState<DragNode>();
  const [query, setQuery] = useState('');
  const [fullToggle, setFullToggle] = useState(false);
  const [filters, setFilters] = useState<AgentFilters>(NO_FILTERS);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedView, setArchivedView] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'> }>();
  const [renaming, setRenaming] = useState<string>();
  const renamingRef = useRef<string | undefined>(undefined);
  const [hits, setHits] = useState<ReadonlyMap<string, string>>(new Map());
  const [picker, setPicker] = useState<{ keys: string[]; name: string; title?: string; current?: string }>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const dialogs = useDialogs();
  const [accountsOpen, setAccountsOpen] = useState(false);
  /** The project row last clicked: of a split project, only that node shows as current. */
  const [selectedNode, setSelectedNode] = useState<string>();
  useCommand(agentsCommands()[21]!, () => setAccountsOpen(true));
  const [manageOpen, setManageOpen] = useState<ManageAccountsMode>();
  /** A new account: with a project selected it becomes active and a new session starts there for `/login`. */
  const accountAdded = async ({ folder, account, linked }: AddedAccount) => {
    const projectId = selectedProjectId ?? sessions.find((x) => x.id === selectedId)?.project;
    const n = String(linked);
    if (!projectId) return void toast({ message: t('agents.accounts.addedSelect', { folder, n }) });
    const r = await setActiveAccount(activeDirOf(account)).catch(() => undefined);
    if (!r?.ok) return void toast({ message: t('agents.accounts.created', { folder, n }) });
    toast({ message: t('agents.accounts.addedLogin', { folder, n }) });
    onNewSession(projectId);
  };

  const parsed = useMemo(() => parseQuery(query), [query]);
  const prefixed = parsed.full;
  const full = fullToggle || prefixed;
  const q = parsed.needle;
  const qStatus = parsed.status;
  const filtered = isFiltering(filters);
  const searching = q !== '' || qStatus !== undefined || filtered;
  const tagFilter = filters.tag;
  useCommand(agentsCommands()[6]!, () => setFilters(clearFilters()));

  useEffect(() => {
    setHits(new Map());
    if (!full || !q) return;
    const ac = new AbortController();
    const found = new Map<string, string>();
    const timer = setTimeout(() => {
      searchSessions(q, (h) => {
        found.set(h.sessionId, h.snippet);
        setHits(new Map(found));
      }, ac.signal).catch(() => {
        if (!ac.signal.aborted) toast({ message: t('agents.search.failed'), kind: 'error' });
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [full, q, toast]);

  const { live, matches, archived } = useMemo(() => {
    const known = new Set(projects.map((p) => p.id));
    const matches = new Map<string, RowMatch>();
    const now = Date.now();
    for (const s of sessions) {
      if (!matchesFilters(s, filters, now)) continue;
      if (qStatus && categoryOf(s) !== qStatus) continue;
      if (!q) matches.set(s.id, {});
      else if (full) {
        const snippet = hits.get(s.id);
        if (snippet !== undefined) matches.set(s.id, { snippet });
      } else {
        const m = fuzzyScore(q, displayName(s));
        if (m) matches.set(s.id, { positions: m.positions });
      }
    }
    const sorted = sessions.filter((s) => matches.has(s.id) && !!s.project && known.has(s.project)).sort(compareSessions);
    return {
      live: sorted.filter((s) => !!s.archived === archivedView),
      matches,
      archived: archivedView ? [] : sorted.filter((s) => s.archived).map((s) => ({ s, m: matches.get(s.id)! })),
    };
  }, [projects, sessions, filters, q, qStatus, full, hits, archivedView]);

  // Pill counts: listed sessions of known projects matching the archived view, ignoring status, time and tag filters.
  const base = useMemo(() => {
    const known = new Set(projects.map((p) => p.id));
    return sessions.filter((s) => !!s.archived === archivedView && !!s.project && known.has(s.project));
  }, [projects, sessions, archivedView]);
  const counts = useMemo(() => statusCounts(base), [base]);

  // Counted over every listed session, archived and filtered-out ones included.
  const tags = useMemo(() => {
    const known = new Set(projects.map((p) => p.id));
    return tagCounts(sessions.filter((s) => !!s.project && known.has(s.project)));
  }, [projects, sessions]);

  const rows = useMemo(
    () => buildRows({ tree: tree ?? { folders: [], topOrder: [], sessionOrder: {}, collapsed: [], sort: 'manual', view: 'normal' }, projects, sessions: live, filtering: searching }),
    [tree, projects, live, searching],
  );

  useEffect(() => {
    onVisibleChange?.(live);
  }, [live, onVisibleChange]);

  // Manual mode freezes positions: record what each expanded project shows (the server appends only missing ids).
  useEffect(() => {
    if (!tree || tree.sort !== 'manual' || searching) return;
    const shown = shownOrders(rows);
    const stale = Object.entries(shown).some(([k, ids]) => ids.some((id) => !tree.sessionOrder[k]?.includes(id)));
    if (stale) patch({ freeze: shown }).catch(() => undefined);
  }, [rows, tree, searching]);

  // Selection across rebuilds: a vanished row moves the selection to its nearest surviving neighbour.
  const prevRows = useRef<TreeRow[]>([]);
  const started = useRef(false);
  useEffect(() => {
    const old = prevRows.current;
    prevRows.current = rows;
    const next = rows.map(rowKey);
    const apply = (key: string | undefined) => {
      const r = rows.find((x) => rowKey(x) === key);
      if (r?.kind === 'session') onSelect(r.session.id);
      else if (r?.kind === 'project') onSelectProject?.(r.project.id);
      else if (r?.kind === 'folder') onSelectFolder?.({ id: r.id, name: r.name, projectIds: r.projectIds });
    };
    if (!selectedId && !selectedProjectId && !selectedFolderId) {
      if (started.current) return;
      const first = rows.find((x) => x.kind === 'session');
      if (first) {
        started.current = true;
        apply(rowKey(first));
      }
      return;
    }
    started.current = true;
    const was = old.find((x) => (selectedId ? x.kind === 'session' && x.session.id === selectedId : selectedProjectId ? x.kind === 'project' && x.project.id === selectedProjectId : x.kind === 'folder' && x.id === selectedFolderId));
    const key = was && rowKey(was);
    if (!key || next.includes(key)) return;
    if (selectedId && live.some((s) => s.id === selectedId)) return;
    apply(reselect(old.map(rowKey), key, next));
  }, [rows]);

  // Previous session: the remembered one becomes "previous" whenever the selected session changes.
  const remembered = useRef<PreviousState>({});
  useEffect(() => {
    remembered.current = trackPrevious(remembered.current, selectedId || undefined);
  }, [selectedId]);
  useCommand(agentsCommands()[8]!, () => {
    const p = remembered.current.previous;
    if (p && sessions.some((s) => s.id === p)) onSelect(p);
    else toast({ message: t('agents.nav.noPrevious') });
  });

  const jumpStarted = (dir: 1 | -1) => {
    const list = expandCollapsedOnActiveJump && tree ? buildRows({ tree: { ...tree, collapsed: [] }, projects, sessions: live, filtering: searching }) : rows;
    const id = stepStarted(startedCandidates(list), selectedId, dir);
    if (id) onSelect(id);
    else toast({ message: t('agents.nav.noStarted') });
  };
  useCommand(agentsCommands()[9]!, () => jumpStarted(-1));
  useCommand(agentsCommands()[10]!, () => jumpStarted(1));
  const cycleSort = () => {
    if (!tree) return;
    const next = SORTS[(SORTS.indexOf(tree.sort) + 1) % SORTS.length]!;
    void send({ sort: next });
    if (next !== 'manual') toast({ message: t(next === 'actionable' ? 'agents.sort.toast.actionable' : 'agents.sort.toast.recent') });
  };
  useCommand(agentsCommands()[7]!, cycleSort);

  /** The reply's tree when the patch applied, else undefined (refusals toasted, `noop` silent). */
  const sendTree = async (p: AgentTreePatch): Promise<TreePatchResult['tree'] | undefined> => {
    try {
      const r = await patch(p);
      if (r.ok) return r.tree;
      if (r.error === 'activeView') toast({ message: t('agents.tree.activeView'), kind: 'error' });
      else if (r.error === 'invalid') toast({ message: t('agents.stateFailed'), kind: 'error' });
    } catch {
      toast({ message: t('agents.stateFailed'), kind: 'error' });
    }
    return undefined;
  };
  const send = async (p: AgentTreePatch): Promise<boolean> => !!(await sendTree(p));

  /** Creates a folder (appended last); undefined when the name is blank or the create failed. */
  const createFolder = async (): Promise<{ id: string; name: string } | undefined> => {
    const raw = await dialogs.prompt({ title: t('agents.folder.newTitle'), label: t('agents.folder.name') });
    const name = raw === null ? '' : folderName(raw);
    if (!name) return undefined;
    const next = await sendTree({ folderCreate: { name } });
    const f = next?.folders[next.folders.length - 1];
    return f && { id: f.id, name: f.name };
  };

  const newFolder = async () => {
    const f = await createFolder();
    if (!f) return;
    onSelectFolder?.({ id: f.id, name: f.name, projectIds: [] });
    toast({ message: t('agents.folder.created', { name: f.name }) });
  };

  const renameFolder = async (id: string, current: string) => {
    const raw = await dialogs.prompt({ title: t('agents.folder.renameTitle'), label: t('agents.folder.name'), value: current });
    const name = raw?.trim();
    if (!name || name === current) return;
    void send({ folderRename: { id, name } });
  };

  const deleteFolder = async (id: string, name: string) => {
    const ok = await dialogs.confirm({ title: t('agents.folder.deleteOk'), body: t('agents.folder.deleteConfirm', { name }), okLabel: t('agents.folder.deleteOk'), danger: true });
    if (ok) void send({ folderDelete: { id } });
  };

  /** Move to folder: the project row, or the session's project; else a hint. */
  const openMove = (r?: TreeRow) => {
    const key = r?.kind === 'project' ? r.key : r?.kind === 'session' ? r.projectKey : undefined;
    const p = key !== undefined ? projects.find((x) => projectKey(x.path) === key) : undefined;
    if (key === undefined || !p) return void toast({ message: t('agents.folder.moveNoTarget') });
    setPicker({ keys: [key], name: p.name, current: tree?.folders.find((f) => f.projects.includes(key))?.id });
  };

  const pickFolder = async (keys: string[], pick: FolderPick) => {
    setPicker(undefined);
    if (pick.to === 'top') {
      if (await send({ moveToFolder: { keys } })) toast({ message: t('agents.folder.movedTop') });
      return;
    }
    const f = pick.to === 'folder' ? tree?.folders.find((x) => x.id === pick.id) : await createFolder();
    if (f && (await send({ moveToFolder: { keys, folder: f.id } }))) toast({ message: t('agents.folder.moved', { name: f.name }) });
  };

  // ---- Checked batch: pruned to sessions that still exist (not to visible ones) on each rebuild.
  useEffect(() => {
    setChecked((c) => pruneBatch(c, sessions.map((s) => s.id)));
  }, [sessions]);

  const clearBatch = (note = false) => {
    setChecked(new Set());
    if (note) toast({ message: t('agents.batch.cleared') });
  };
  const checking = checked.size > 0;
  const toggleCheck = (id: string) => setChecked((c) => toggleChecked(c, id));

  /** The checked sessions in session-list order: tree rows, then archived, then any hidden by search or filters. */
  const batchSessions = () => batchOrder([...rows.flatMap((r) => (r.kind === 'session' ? [r.session] : [])), ...archived.map((x) => x.s), ...sessions], checked);

  const batchStop = async () => {
    const list = batchSessions();
    clearBatch();
    const tally = { stopped: 0, notRunning: 0 };
    let failed = false;
    for (const s of list) {
      if (s.external || !(s.live || s.lifecycle !== undefined) || !s.id) {
        tally.notRunning++;
        continue;
      }
      try {
        await stopSession(s.id);
        tally.stopped++;
      } catch {
        failed = true;
      }
    }
    const o = stopOutcome(tally);
    toast({ message: o === 'none' ? t('agents.batch.noneRunning') : o === 'all' ? t('agents.batch.stopped', { n: String(tally.stopped) }) : t('agents.batch.stoppedSome', { n: String(tally.stopped), k: String(tally.notRunning) }) });
    if (failed) toast({ message: t('agents.stateFailed'), kind: 'error' });
  };

  const batchTags = async () => {
    const ids = batchSessions().map((s) => s.id).filter((id) => !!id);
    const raw = ids.length ? await dialogs.prompt({ title: t('agents.batch.tags'), label: t('agents.batch.tagsPrompt', { n: String(ids.length) }) }) : null;
    const list = raw === null ? [] : parseTags(raw);
    clearBatch(list.length === 0);
    if (!list.length) return;
    addTags(ids, list)
      .then(() => toast({ message: t('agents.batch.tagsAdded', { tags: list.join(', '), n: String(ids.length) }) }))
      .catch(() => toast({ message: t('agents.stateFailed'), kind: 'error' }));
  };

  const batchMove = () => {
    const pathOf = new Map(projects.map((p) => [p.id, p.path]));
    const keys = distinctKeys(batchSessions().map((s) => (s.project && pathOf.has(s.project) ? projectKey(pathOf.get(s.project)!) : undefined)));
    if (!keys.length) {
      clearBatch();
      return void toast({ message: t('agents.folder.moveNoTarget') });
    }
    const one = keys.length === 1 ? keys[0]! : undefined;
    setPicker({ keys, name: '', title: t('agents.batch.moveTitle', { n: String(keys.length) }), current: one && tree?.folders.find((f) => f.projects.includes(one))?.id });
  };

  const batchArchive = async () => {
    const list = batchSessions();
    clearBatch();
    const un = archivedView;
    const { ok, working } = partitionArchive(list, un);
    let failed = false;
    let done = 0;
    for (const { s, stop } of ok) {
      try {
        if (stop) await stopSession(s.id);
        await patchSessionState(s.id, { archived: !un });
        done++;
      } catch {
        failed = true;
      }
    }
    const o = archiveOutcome(done, working);
    const p = un ? 'unarchive' : 'archive';
    const key = o === 'empty' ? `agents.batch.${p}Empty` : o === 'all' ? `agents.batch.${un ? 'unarchived' : 'archived'}` : o === 'some' ? `agents.batch.${un ? 'unarchived' : 'archived'}Some` : `agents.batch.${un ? 'unarchived' : 'archived'}None`;
    toast({ message: t(key as 'agents.batch.archived', { n: String(done), k: String(working) }) });
    if (failed) toast({ message: t('agents.stateFailed'), kind: 'error' });
  };

  const toggleArchivedView = () => {
    const next = !archivedView;
    setArchivedView(next);
    toast({ message: t(next ? 'agents.view.archived' : 'agents.view.active') });
  };
  useCommand(agentsCommands()[16]!, toggleArchivedView);
  useCommand(agentsCommands()[15]!, () => {
    const s = currentSession();
    if (s) void archiveOne(s);
  });

  const [trashOpen, setTrashOpen] = useState(false);
  const restored = (id: string, title: string) => {
    toast({ message: t('agents.trash.restored', { title }) });
    onSelect(id);
  };
  const deleteOne = async (s: AgentSessionView) => {
    if (!s.id) return void toast({ message: t('agents.pin.needsId') });
    try {
      await deleteSession(s.id);
      toast({ message: t('agents.delete.flash') });
    } catch (e) {
      toast({ message: e instanceof Error && e.message ? e.message : t('agents.stateFailed'), kind: 'error' });
    }
  };
  const batchDelete = async () => {
    const list = batchSessions();
    clearBatch();
    const ids = list.filter((s) => s.id && !isWorking(s)).map((s) => s.id);
    let skipped = list.length - ids.length;
    let done = 0;
    if (ids.length) {
      try {
        const r = await deleteSessions(ids);
        done = r.deleted.length;
        skipped += r.skipped.length;
      } catch {
        return void toast({ message: t('agents.stateFailed'), kind: 'error' });
      }
    }
    const o = archiveOutcome(done, skipped);
    const key = o === 'empty' ? 'agents.batch.deleteEmpty' : o === 'all' ? 'agents.batch.deleted' : o === 'some' ? 'agents.batch.deletedSome' : 'agents.batch.deletedNone';
    toast({ message: t(key, { n: String(done), k: String(skipped) }) });
  };
  const undo = async () => {
    try {
      const r = await undoDelete();
      if (r.ok) restored(r.id, r.title || r.id);
      else toast({ message: trashMessage(r.error) });
    } catch {
      toast({ message: t('agents.stateFailed'), kind: 'error' });
    }
  };
  useCommand(agentsCommands()[17]!, () => {
    const s = currentSession();
    if (s) void deleteOne(s);
  });
  useCommand(agentsCommands()[18]!, () => void undo());
  useCommand(agentsCommands()[19]!, () => setTrashOpen(true));

  // Batch actions in bar order.
  const batchActions: BatchAction[] = [
    { id: 'stop', label: t('agents.batch.stop'), run: () => void batchStop() },
    { id: 'tags', label: t('agents.batch.tags'), run: () => void batchTags() },
    { id: 'move', label: t('agents.batch.move'), run: batchMove },
    { id: 'archive', label: archivedView ? t('agents.unarchive') : t('agents.archive'), run: () => void batchArchive() },
    { id: 'delete', label: t('agents.delete'), run: () => void batchDelete(), danger: true },
  ];
  const ifBatch = (run: () => void) => () => (checked.size ? run() : undefined);
  useCommand(agentsCommands()[11]!, ifBatch(() => void batchStop()));
  useCommand(agentsCommands()[12]!, ifBatch(() => void batchTags()));
  useCommand(agentsCommands()[13]!, ifBatch(batchMove));
  useCommand(agentsCommands()[14]!, ifBatch(() => clearBatch(true)));

  /** Space on a session row: toggle its check, then focus the next selectable row. */
  const spaceCheck = (el: HTMLElement, id: string) => {
    toggleCheck(id);
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('.agents-session, .agents-node') ?? [])];
    all[all.indexOf(el) + 1]?.focus();
  };

  const confirmRemove = async (p: AgentProject) => {
    const ok = await dialogs.confirm({ title: t('agents.remove'), body: t('agents.remove.confirm', { name: p.name }), okLabel: t('agents.remove.ok'), danger: true });
    if (ok) onRemoveProject(p.id);
  };

  const editTags = async (s: AgentSessionView) => {
    if (!s.id) return void toast({ message: t('agents.tags.needsId') });
    const raw = await dialogs.prompt({ title: t('agents.tags.editTitle'), label: t('agents.tags.prompt', { title: displayName(s) }), value: (s.tags ?? []).join(', ') });
    if (raw === null) return;
    const list = parseTags(raw);
    patchSessionState(s.id, { tags: list })
      .then(() => toast({ message: list.length ? t('agents.tags.set', { tags: list.join(', ') }) : t('agents.tags.cleared') }))
      .catch(() => toast({ message: t('agents.stateFailed'), kind: 'error' }));
  };

  const removeTag = async (tag: string) => {
    if (!(await dialogs.confirm({ title: t('agents.tags.removeAll'), body: t('agents.tags.removeConfirm', { tag }), okLabel: t('agents.remove.ok'), danger: true }))) return;
    try {
      const r = await removeTagEverywhere(tag);
      setFilters((f) => (f.tag === tag ? { ...f, tag: undefined } : f));
      toast({ message: t('agents.tags.removed', { tag, count: String(r.count) }) });
    } catch {
      toast({ message: t('agents.stateFailed'), kind: 'error' });
    }
  };

  const setCollapsed = (key: string, collapsed: boolean) => void send({ collapse: { key, collapsed } });

  // Jumping to a hidden session: un-collapse its project and that project's folder; a filtered-out one gets a hint.
  const jumped = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedId || jumped.current === selectedId || !tree) return;
    jumped.current = selectedId;
    const s = sessions.find((x) => x.id === selectedId);
    const p = s && !s.archived ? projects.find((x) => x.id === s.project) : undefined;
    if (!s || !p) return;
    if (!matches.has(s.id)) {
      toast({ message: t('agents.tree.hiddenByFilter') });
      return;
    }
    const key = projectKey(p.path);
    const folder = tree.folders.find((f) => f.projects.includes(key));
    const node = projectNodeKey(sessionNodeKey(key, p.id, s));
    if (tree.collapsed.includes(node)) setCollapsed(node, false);
    if (folder && tree.collapsed.includes(folderNodeKey(folder.id))) setCollapsed(folderNodeKey(folder.id), false);
  }, [selectedId, tree, sessions, projects, matches]);

  /** One neighbour swap per step; `displayed` is updated locally between steps, as the server swaps it. */
  const moveSteps = async (displayed: string[], id: string, to: number, step: (displayed: string[], dir: -1 | 1) => AgentTreePatch) => {
    const list = [...displayed];
    let at = list.indexOf(id);
    if (at < 0 || to < 0 || to >= list.length) return;
    while (at !== to) {
      const dir: -1 | 1 = to > at ? 1 : -1;
      if (!(await send(step([...list], dir)))) return;
      [list[at], list[at + dir]] = [list[at + dir]!, list[at]!];
      at += dir;
    }
  };

  const rowMove = (r: TreeRow, to: number) => {
    if (r.kind === 'folder') return moveSteps(r.displayed, r.id, to, (_, dir) => ({ move: { kind: 'folder', id: r.id, dir } }));
    if (r.kind === 'project') return moveSteps(r.displayed, r.key, to, (displayed, dir) => ({ move: { kind: 'project', key: r.key, dir, folder: r.folder, displayed } }));
    if (r.kind === 'session') {
      if (!r.session.id) return void toast({ message: t('agents.pin.needsId') });
      return moveSteps(r.displayed, r.session.id, to, (displayed, dir) => ({ move: { kind: 'session', project: r.projectKey, id: r.session.id, dir, displayed } }));
    }
  };

  const rowId = (r: TreeRow) => (r.kind === 'folder' ? r.id : r.kind === 'project' ? r.key : r.kind === 'session' ? r.session.id : '');
  const container = (r: TreeRow) => (r.kind === 'folder' ? 'folders' : r.kind === 'project' ? `projects:${r.folder ?? ''}` : r.kind === 'session' ? `sessions:${r.projectKey}` : '');

  const moveItems = (r: TreeRow): ContextMenuItem[] => {
    const id = rowId(r);
    const at = r.kind === 'divider' ? -1 : r.displayed.indexOf(id);
    if (r.kind === 'divider' || at < 0) return [];
    const len = r.displayed.length;
    return [
      { id: 'moveUp', label: t('agents.tree.moveUp'), disabled: at === 0, run: () => void rowMove(r, at - 1) },
      { id: 'moveDown', label: t('agents.tree.moveDown'), disabled: at === len - 1, run: () => void rowMove(r, at + 1) },
    ];
  };

  /** Drag-and-drop within one container: the same neighbour swaps as Move up/down. */
  const dragProps = (r: TreeRow) => {
    const id = rowId(r);
    const box = container(r);
    return {
      draggable: !!id,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        setDrag({ container: box, id });
      },
      onDragEnd: () => setDrag(undefined),
      onDragOver: (e: DragEvent) => {
        if (drag && drag.container === box && drag.id !== id) e.preventDefault();
      },
      onDrop: (e: DragEvent) => {
        if (!drag || drag.container !== box || r.kind === 'divider') return;
        e.preventDefault();
        const from = drag.id;
        setDrag(undefined);
        const to = r.displayed.indexOf(id);
        const moved = r.kind === 'folder' ? { ...r, id: from } : r.kind === 'project' ? { ...r, key: from } : { ...r, session: { ...r.session, id: from } };
        void rowMove(moved, to);
      },
    };
  };

  // ---- Keyboard: the focused row (else the selected one) is the target of the list commands.
  const listItems = () => [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
  const focusedItem = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(ITEMS) ?? null;
  /** Index in rows of the focused list row, else of the selected one; -1 when none. */
  const currentIndex = () => {
    const at = listItems().indexOf(focusedItem()!);
    if (at >= 0) {
      let n = -1;
      const i = rows.findIndex((r) => r.kind !== 'divider' && ++n === at);
      if (i >= 0) return i;
    }
    return rows.findIndex((r) => (selectedId ? r.kind === 'session' && r.session.id === selectedId : selectedProjectId ? r.kind === 'project' && r.project.id === selectedProjectId : r.kind === 'folder' && r.id === selectedFolderId));
  };
  const currentRow = () => rows[currentIndex()];
  const currentSession = () => {
    const r = currentRow();
    return r?.kind === 'session' ? r.session : undefined;
  };
  const focusRow = (i: number) => {
    const el = listItems()[rowToSelectable(rows, i)];
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'center' });
  };
  const moveFocus = (dir: -1 | 1) => {
    const list = listItems();
    const at = list.indexOf(focusedItem()!);
    const next = at < 0 ? undefined : list[at + dir];
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'center' });
  };
  const arrow = (dir: 'left' | 'right') => {
    const i = currentIndex();
    const r = rows[i];
    const a = r && (dir === 'left' ? leftAction(rows, i) : rightAction(rows, i));
    if (!a) return;
    if (a.kind === 'move') focusRow(a.to);
    else if (r.kind === 'folder' || r.kind === 'project') setCollapsed(r.kind === 'folder' ? folderNodeKey(r.id) : projectNodeKey(r.node), a.kind === 'collapse');
  };
  const reorder = (dir: -1 | 1) => {
    const r = currentRow();
    if (!r || r.kind === 'divider') return;
    const at = r.displayed.indexOf(rowId(r));
    if (at >= 0) void rowMove(r, at + dir);
  };
  const onSession = (fn: (s: AgentSessionView) => void) => () => {
    const s = currentSession();
    if (s) fn(s);
  };
  useCommand(agentsCommands()[25]!, () => {
    const r = currentRow();
    const id = r?.kind === 'project' ? r.project.id : r?.kind === 'session' ? r.session.project : undefined;
    if (id) onQuickNew(id);
  });
  useCommand(agentsCommands()[28]!, () => {
    const r = currentRow();
    if (r?.kind === 'folder') void renameFolder(r.id, r.name);
    else if (r?.kind === 'session') setTimeout(() => startRename(r.session.id), 0);
  });
  useCommand(agentsCommands()[33]!, onSession((s) => toggleCheck(s.id)));
  useCommand(agentsCommands()[34]!, onSession((s) => void markUnread(s.id).catch(() => undefined)));
  useCommand(agentsCommands()[35]!, onSession((s) => void markSeen(s.id).catch(() => undefined)));
  useCommand(agentsCommands()[36]!, onSession((s) => cyclePin(s)));
  useCommand(agentsCommands()[37]!, () => void newFolder());
  useCommand(agentsCommands()[38]!, () => openMove(currentRow()));
  useCommand(agentsCommands()[39]!, onSession((s) => void editTags(s)));
  useCommand(agentsCommands()[40]!, () => reorder(-1));
  useCommand(agentsCommands()[41]!, () => reorder(1));
  useCommand(agentsCommands()[42]!, () => {
    if (!tree) return;
    const next = tree.view === 'active' ? 'normal' : 'active';
    void send({ view: next });
    toast({ message: t(next === 'active' ? 'agents.view.toast.active' : 'agents.view.toast.normal') });
  });
  useCommand(agentsCommands()[43]!, () => setFilters(nextTime));
  useCommand(agentsCommands()[44]!, () => moveFocus(-1));
  useCommand(agentsCommands()[45]!, () => moveFocus(1));
  useCommand(agentsCommands()[46]!, () => arrow('left'));
  useCommand(agentsCommands()[47]!, () => arrow('right'));
  useCommand(agentsCommands()[51]!, () => {
    const root = ref.current;
    if (!root) return;
    const item = root.querySelector<HTMLElement>(`.agents-tree .agents-session[aria-current]`) ?? root.querySelector<HTMLElement>(`${ITEMS}[aria-current], ${ITEMS}[tabindex="0"]`) ?? root.querySelector<HTMLElement>(ITEMS);
    (item ?? root).focus();
  });
  useCommand(agentsCommands()[48]!, () => setTimeout(() => ref.current?.querySelector<HTMLInputElement>('.agents-search input')?.focus(), 0));

  const pill = (key: string, active: boolean, label: ReactNode, aria: string, onClick: () => void, status?: AgentStatus) => (
    <button key={key} type="button" className={`agents-pill${status ? ` ${status}` : ''}`} aria-pressed={active} title={aria} aria-label={aria} onClick={onClick}>
      {label}
    </button>
  );
  const categoryPill = (c: AgentCategory, glyph: string, status: AgentStatus, count: number, name: string, done = false) =>
    pill(`c-${done ? 'done' : c}`, filters.status.has(c), <><span className="agents-pill-glyph">{glyph}</span>{count}</>, `${name} (${count})`, () => setFilters((f) => toggleStatus(f, c)), status);
  const pillsMenu = (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ at: { x: e.clientX, y: e.clientY }, items: [{ id: 'clearFilters', label: t('agents.filter.clear'), disabled: !filtered, run: () => setFilters(clearFilters()) }] });
  };

  const update = (id: string, state: Parameters<typeof patchSessionState>[1]) => {
    patchSessionState(id, state).catch(() => toast({ message: t('agents.stateFailed'), kind: 'error' }));
  };

  const startRename = (id: string) => {
    renamingRef.current = id;
    setRenaming(id);
  };

  const commitRename = (s: AgentSessionView, value: string) => {
    if (renamingRef.current !== s.id) return;
    renamingRef.current = undefined;
    setRenaming(undefined);
    const v = value.trim();
    if (v === (s.name || s.title)) return;
    update(s.id, { name: v === '' || v === s.title ? null : v });
  };

  const archiveOne = async (s: AgentSessionView) => {
    if (!s.id) return void toast({ message: t('agents.pin.needsId') });
    const un = !!s.archived;
    if (!un && isWorking(s)) return void toast({ message: t('agents.archive.refuse') });
    try {
      if (!un && liveHere(s)) await stopSession(s.id);
      await patchSessionState(s.id, { archived: !un });
      toast({ message: t(un ? 'agents.unarchive.flash' : 'agents.archive.flash') });
    } catch {
      toast({ message: t('agents.stateFailed'), kind: 'error' });
    }
  };

  const lifecycleItems = (s: AgentSessionView): Array<ContextMenuItem | 'sep'> => {
    if (s.external) return [];
    const live = !!s.live || s.lifecycle !== undefined;
    const items: ContextMenuItem[] = [];
    if (!live && onStartBackground) items.push({ id: 'startBackground', label: t('agents.startBackground'), run: () => onStartBackground(s) });
    if (live && onStop) items.push({ id: 'stop', label: t('agents.stop'), run: () => onStop(s) });
    if (onRestart) items.push({ id: 'restart', label: t('agents.restart'), run: () => onRestart(s) });
    return items.length ? [...items, 'sep'] : [];
  };

  const cyclePin = (s: AgentSessionView) => {
    if (!s.id) return void toast({ message: t('agents.pin.needsId') });
    const next = nextPin(s.pin);
    patchSessionState(s.id, { pin: 'cycle' })
      .then(() => toast({ message: t(next === 'top' ? 'agents.pin.flashTop' : next === 'bottom' ? 'agents.pin.flashBottom' : 'agents.pin.flashNone') }))
      .catch(() => toast({ message: t('agents.stateFailed'), kind: 'error' }));
  };

  const menuItems = (s: AgentSessionView, r?: TreeRow): Array<ContextMenuItem | 'sep'> => [
    ...lifecycleItems(s),
    { id: 'pin', label: s.pin === 'top' ? t('agents.pin.bottom') : s.pin === 'bottom' ? t('agents.unpin') : t('agents.pin.top'), run: () => cyclePin(s) },
    ...(r ? moveItems(r) : []),
    ...(r ? [{ id: 'moveToFolder', label: t('agents.folder.move'), run: () => openMove(r) }] : []),
    { id: 'tags', label: t('agents.tags.edit'), run: () => void editTags(s) },
    // Deferred so the menu gives the focus back before the rename input takes it.
    { id: 'unread', label: t('agents.markUnread'), run: () => void markUnread(s.id).catch(() => undefined) },
    { id: 'rename', label: t('agents.rename'), hint: 'F2', run: () => setTimeout(() => startRename(s.id), 0) },
    'sep',
    { id: 'archive', label: s.archived ? t('agents.unarchive') : t('agents.archive'), run: () => void archiveOne(s) },
    { id: 'delete', label: t('agents.delete'), danger: true, run: () => void deleteOne(s) },
  ];

  const row = ({ s, m }: { s: AgentSessionView; m: RowMatch }, r?: Extract<TreeRow, { kind: 'session' }>) => {
    const label = statusLabel(s.status);
    const name = displayName(s);
    const connector = r && <span className="agents-connector" aria-hidden="true">{r.last ? '└─' : '├─'}</span>;
    if (renaming === s.id) {
      return (
        <div key={s.id} className="agents-session-edit" style={r && depthStyle(r.depth)}>
          {connector}
          <span className={`agents-glyph ${s.status}`} role="img" title={label} aria-label={label}>{STATUS_GLYPH[s.status]}</span>
          <input
            className="agents-rename"
            autoFocus
            defaultValue={s.name || s.title}
            aria-label={t('agents.rename.label')}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename(s, e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                renamingRef.current = undefined;
                setRenaming(undefined);
              }
            }}
            onBlur={(e) => commitRename(s, e.currentTarget.value)}
          />
        </div>
      );
    }
    const use = usageSettings?.show && s.live ? sessionUsage(s) : undefined;
    const pin = s.pin ?? (s.pinned ? 'top' : undefined);
    const pinLabel = t(pin === 'top' ? 'agents.pinned' : 'agents.pinnedBottom');
    const tone = s.status === 'running' || s.status === 'needs-you' ? ' strong' : s.status === 'error' ? ' failed' : '';
    return (
      <button
        key={s.id}
        type="button"
        className={`agents-session${s.id === selectedId ? ' selected' : ''}${pin ? ' pinned' : ''}${tone}${s.foreign ? ' other-account' : ''}${r && drag?.id === s.id ? ' dragging' : ''}`}
        style={r && depthStyle(r.depth)}
        {...(r ? dragProps(r) : {})}
        aria-current={s.id === selectedId ? 'true' : undefined}
        onClick={(e) => (e.ctrlKey || e.metaKey ? toggleCheck(s.id) : onSelect(s.id))}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ at: { x: e.clientX, y: e.clientY }, items: menuItems(s, r) });
        }}
        onKeyDown={(e) => {
          if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            spaceCheck(e.currentTarget, s.id);
          } else if (e.key === 'F2') {
            e.preventDefault();
            startRename(s.id);
          }
        }}
      >
        <span className="agents-lead">
          {checking && (
            <span
              className={`agents-check${checked.has(s.id) ? ' on' : ''}`}
              role="checkbox"
              aria-checked={checked.has(s.id)}
              aria-label={t('agents.batch.check')}
              title={t('agents.batch.check')}
              onClick={(e) => {
                e.stopPropagation();
                toggleCheck(s.id);
              }}
            >{checked.has(s.id) ? '✓' : ''}</span>
          )}
        </span>
        {connector}
        <span className={`agents-glyph ${s.status}`} role="img" title={label} aria-label={label}>{STATUS_GLYPH[s.status]}</span>
        {pin && <span className="agents-mark" role="img" title={pinLabel} aria-label={pinLabel}>{pin === 'top' ? '↑' : '↓'}</span>}
        {s.external && <span className="agents-mark" role="img" title={t('agents.external.note')} aria-label={t('agents.external')}>↗</span>}
        <span className="agents-session-main">
        <span className="agents-session-text">
          <span className="agents-session-title" title={name}>
            {m.positions ? highlightRuns(name, m.positions).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : r.text)) : name}
          </span>
          {m.snippet && <span className="agents-session-snippet" title={m.snippet}>{m.snippet}</span>}
        </span>
        {s.owner && <span className="agents-owner" title={s.owner}>{s.owner}</span>}
        {use && <span className={`agents-ctx sev-${severity('context', s.contextPercent ?? 0)}`} title={use.title}>{use.line}</span>}
        </span>
      </button>
    );
  };

  const nodeRow = (r: Extract<TreeRow, { kind: 'folder' | 'project' }>, nodeKey: string, name: string, title: string, current: boolean, select: (() => void) | undefined, extra: ReactNode, items: Array<ContextMenuItem | 'sep'>) => {
    const toggle = () => setCollapsed(nodeKey, !r.collapsed);
    const expand = r.collapsed ? t('agents.tree.expand') : t('agents.tree.collapse');
    return (
      <div
        key={nodeKey}
        className={`${r.kind === 'folder' ? 'agents-folder-row' : 'agents-group-row'}${drag?.id === rowId(r) ? ' dragging' : ''}`}
        style={depthStyle(r.depth)}
        {...dragProps(r)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ at: { x: e.clientX, y: e.clientY }, items });
        }}
      >
        <button type="button" className="agents-twisty" tabIndex={-1} aria-expanded={!r.collapsed} title={expand} aria-label={expand} onClick={toggle}>{r.collapsed ? '▸' : '▾'}</button>
        <button
          type="button"
          className={`agents-node ${r.kind}`}
          title={title}
          aria-expanded={!r.collapsed}
          aria-current={current ? 'true' : undefined}
          onClick={select ?? toggle}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            toggle();
          }}
        >{name}</button>
        <GroupCounts list={r.sessions} />
        {r.kind === 'project' && <GitBadge list={r.sessions} git={git} />}
        {extra}
      </div>
    );
  };

  const treeRow = (r: TreeRow, i: number) => {
    if (r.kind === 'divider') return <div key={`divider-${i}`} className="agents-divider" role="separator">{t('agents.tree.idleDone')}</div>;
    if (r.kind === 'session') return row({ s: r.session, m: matches.get(r.session.id) ?? {} }, r);
    if (r.kind === 'folder') {
      const select = onSelectFolder && (() => onSelectFolder({ id: r.id, name: r.name, projectIds: r.projectIds }));
      const items: Array<ContextMenuItem | 'sep'> = [
        ...moveItems(r),
        'sep',
        { id: 'newFolder', label: t('agents.folder.new'), run: () => void newFolder() },
        { id: 'renameFolder', label: t('agents.folder.rename'), run: () => void renameFolder(r.id, r.name) },
        { id: 'deleteFolder', label: t('agents.folder.delete'), danger: true, run: () => void deleteFolder(r.id, r.name) },
      ];
      return nodeRow(r, folderNodeKey(r.id), r.name, r.name, r.id === selectedFolderId, select, null, items);
    }
    const p = r.project;
    const select = onSelectProject && (() => {
      setSelectedNode(r.node);
      onSelectProject(p.id);
    });
    const extra = (
      <span>
        <button type="button" className="agents-remove" title={t('agents.remove')} aria-label={t('agents.remove')} onClick={() => void confirmRemove(p)}>x</button>
        <button type="button" className="agents-new" title={t('agents.new.title')} aria-label={t('agents.new.title')} onClick={() => onQuickNew(p.id)}>+</button>
      </span>
    );
    const items: Array<ContextMenuItem | 'sep'> = [
      { id: 'new', label: t('agents.new.title'), run: () => onQuickNew(p.id) },
      ...moveItems(r),
      { id: 'moveToFolder', label: t('agents.folder.move'), run: () => openMove(r) },
      { id: 'newFolder', label: t('agents.folder.new'), run: () => void newFolder() },
      'sep',
      { id: 'remove', label: t('agents.remove'), danger: true, run: () => void confirmRemove(p) },
    ];
    const label = r.suffix ? `${p.name} · ${r.suffix}` : p.name;
    return nodeRow(r, projectNodeKey(r.node), label, r.suffix ? `${p.path} · ${r.suffix}` : p.path, p.id === selectedProjectId && (selectedNode === undefined || selectedNode === r.node), select, extra, items);
  };

  const archivedShown = archivedOpen || searching;
  return (
    <nav
      className={`agents-sidebar${checking ? ' checking' : ''}`}
      aria-label={t('agents.sidebar')}
      ref={ref}
      tabIndex={-1}
      {...{ [KEY_SCOPE_ATTR]: AGENTS_LIST_SCOPE }}
      onKeyDown={(e) => {
        if (!e.defaultPrevented && !e.ctrlKey && !e.altKey && !e.metaKey && e.target instanceof Element && e.target.matches(ITEMS)) {
          const status = STATUS_KEYS[e.key];
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            arrow(e.key === 'ArrowLeft' ? 'left' : 'right');
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? -1 : 1;
            if (e.shiftKey) reorder(dir);
            else moveFocus(dir);
          } else if (status) {
            e.preventDefault();
            setFilters((f) => toggleStatus(f, status));
          }
        }
        if (e.key !== 'Escape' || e.defaultPrevented || !checking) return;
        e.preventDefault();
        e.stopPropagation();
        clearBatch(true);
      }}
    >
      <h2 className="agents-panel-title">
        {t('agents.sidebar')}
        {(() => {
          const note = titleNote({ selected: checked.size, archived: archivedView, filtered, actionable: tree?.sort === 'actionable', activeOnTop: tree?.view === 'active' }, TITLE_LABELS);
          return note && <span className="agents-panel-note"> {note}</span>;
        })()}
      </h2>
      {usageSettings?.position === 'top' && usageBlock}
      {sessions.length > 0 && (
        <div className="agents-find">
          <div className="agents-search">
            <input
              type="search"
              value={query}
              placeholder={t('agents.search.placeholder')}
              aria-label={t('agents.search')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  setQuery('');
                }
              }}
            />
            <button
              type="button"
              className="agents-search-mode"
              aria-pressed={full}
              title={t('agents.search.fullText')}
              aria-label={t('agents.search.fullText')}
              onClick={() => {
                if (prefixed) {
                  setQuery(query.replace('?', ''));
                  setFullToggle(false);
                } else setFullToggle((v) => !v);
              }}
            >?</button>
          </div>
          <div className="agents-pills" role="group" aria-label={t('agents.filter')} onContextMenu={pillsMenu}>
            {pill('all', filters.status.size === 0, `${t('agents.filter.all')} ${base.length}`, `${t('agents.filter.all')} (${base.length})`, () => setFilters(clearStatus))}
            {CATEGORIES.flatMap((c) => {
              const p = CATEGORY_PILL[c];
              const one = categoryPill(c, p.glyph, p.status, counts[c], statusLabel(p.status));
              return c === 'waiting' ? [one, categoryPill('waiting', '✓', 'done', counts.done, t('agents.filter.done'), true)] : [one];
            })}
            <span className="agents-pill-sep" aria-hidden="true">│</span>
            {pill('time', filters.time !== 'all', timeLabel(filters.time), t('agents.time.title', { mode: timeLabel(filters.time) }), () => setFilters(nextTime))}
            {tagFilter !== undefined && (
              <>
                <span className="agents-pill-sep" aria-hidden="true">│</span>
                {pill('tag', true, `# ${tagFilter}`, t('agents.filter.tagClear'), () => setFilters((f) => ({ ...f, tag: undefined })))}
              </>
            )}
          </div>
        </div>
      )}
      {projects.length === 0 && (
        <p className="agents-empty">
          {t('agents.empty')}. {t('agents.emptyHint')}
        </p>
      )}
      {projects.length > 0 && sessions.length === 0 && <p className="agents-empty">{t('agents.filter.noSessions')}</p>}
      {sessions.length > 0 && rows.length === 0 && archived.length === 0 && <p className="agents-empty">{t('agents.filter.noMatch')}</p>}
      {rows.length > 0 && <div className="agents-tree">{rows.map(treeRow)}</div>}
      {tags.length > 0 && (
        <div className="agents-tags">
          <div className="agents-divider" role="separator">{t('agents.tags')}</div>
          {tags.map(({ tag, count }) => {
            const label = `# ${tag} (${count})`;
            return (
              <button
                key={tag}
                type="button"
                className={`agents-tag-row agents-node${tag === tagFilter ? ' active' : ''}`}
                title={t('agents.tags.filter', { tag })}
                aria-pressed={tag === tagFilter}
                onClick={() => setFilters((f) => toggleTag(f, tag))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ at: { x: e.clientX, y: e.clientY }, items: [{ id: 'removeTag', label: t('agents.tags.removeAll'), danger: true, run: () => void removeTag(tag) }] });
                }}
              >
                <span className="agents-tag-name">{label}</span>
              </button>
            );
          })}
        </div>
      )}
      {archived.length > 0 && (
        <section className="agents-project agents-archived">
          <header className="agents-group-row">
            <button type="button" className="agents-archived-toggle" aria-expanded={archivedShown} onClick={() => setArchivedOpen((v) => !v)}>
              <span aria-hidden="true">{archivedShown ? '▾' : '▸'}</span> {t('agents.archived')} ({archived.length})
            </button>
          </header>
          {archivedShown && archived.map((x) => row(x))}
        </section>
      )}
      {usageSettings?.position !== 'top' && usageBlock}
      {checking && <BatchBar count={checked.size} actions={batchActions} onClear={() => clearBatch(true)} />}
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} />}
      {trashOpen && <TrashPanel onRestored={restored} onRefused={(message) => toast({ message, kind: 'error' })} onClose={() => setTrashOpen(false)} />}
      {accountsOpen && <AccountPicker onAdd={() => setManageOpen('add')} onManage={() => setManageOpen('manage')} onClose={() => setAccountsOpen(false)} />}
      {manageOpen && <ManageAccounts mode={manageOpen} onAdded={(a) => void accountAdded(a)} onChanged={() => undefined} onClose={() => setManageOpen(undefined)} />}
      {picker && tree && <MoveToFolder name={picker.name} title={picker.title} folders={tree.folders} current={picker.current} onPick={(pick) => {
        if (picker.title) clearBatch();
        void pickFolder(picker.keys, pick);
      }} onClose={() => setPicker(undefined)} />}
      {dialogs.element}
    </nav>
  );
}

/** '⇡' / '⇣' / '✱' when any visible session of the project is ahead, behind or dirty; nothing without git data. */
function GitBadge({ list, git }: { list: AgentSessionView[]; git: GitStatusMap }) {
  const b = projectGitBadge(list, git);
  if (!b || (!b.ahead && !b.behind && !b.dirty)) return null;
  const tip = [b.ahead > 0 && t('agents.git.ahead', { n: b.ahead }), b.behind > 0 && t('agents.git.behind', { n: b.behind }), b.dirty > 0 && t('agents.git.dirty', { n: b.dirty })].filter(Boolean).join(' · ');
  return (
    <span className="agents-git-badge" title={tip} aria-label={tip}>
      {b.ahead > 0 && <span className="ahead">⇡</span>}
      {b.behind > 0 && <span className="behind">⇣</span>}
      {b.dirty > 0 && <span className="dirty">✱</span>}
    </span>
  );
}

/** '(count)', then '●R' and '◐W' only when non-zero, after a folder or project name. */
function GroupCounts({ list }: { list: AgentSessionView[] }) {
  const running = list.filter((s) => s.status === 'running' || s.status === 'starting').length;
  const waiting = list.filter((s) => s.status === 'needs-you').length;
  return (
    <span className="agents-group-counts">
      <span className="agents-group-count">({list.length})</span>
      {running > 0 && <span className="agents-glyph running" title={t('agents.status.running')}>●{running}</span>}
      {waiting > 0 && <span className="agents-glyph needs-you" title={t('agents.status.needs-you')}>◐{waiting}</span>}
    </span>
  );
}
