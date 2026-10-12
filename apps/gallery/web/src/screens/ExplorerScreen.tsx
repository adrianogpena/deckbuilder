import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  activate,
  activeTab,
  addTab,
  focusedPane,
  pinTab,
  closeTab,
  type ContextMenuItem,
  dialogs,
  Empty,
  errorOf,
  ErrorBanner,
  Explorer,
  Icon,
  type ApiError,
  type FieldSpec,
  Modal,
  navigate,
  newTab,
  openBeside,
  PageHead,
  PanelLoading,
  ResourceForm,
  restore,
  serialize,
  setPreview,
  singlePane,
  Spinner,
  SplitView,
  TabWorkspace,
  useAsync,
  useCommand,
  useDebouncedSave,
  type Layout,
  fileIconOf,
  fileSettingsOf,
  relPath,
} from '@deckbuilder/ui';
import { closeSession } from '@deckbuilder/terminal';
import { api, type ExplorerSettings, type LogSettings, type Project, type Settings } from '../api';
import { commandById } from '../commands';
import { fullPath, nodeId } from '../explorer-paths';
import { t } from '../i18n';
import { ProjectPicker } from './explorer/ProjectPicker';
import { useCopyPath } from './explorer/copy-path';
import { useFileUndo } from './explorer/file-undo';
import type { ProjectTreeApi } from './explorer/ProjectTree';
import { TreePane } from './explorer/TreePane';

// The editor and viewers are large; they load when the first file opens.
const FileTab = lazy(() => import('./explorer/FileTab').then((m) => ({ default: m.FileTab })));
const TerminalPane = lazy(() => import('@deckbuilder/terminal').then((m) => ({ default: m.TerminalPane })));

type Route = { kind: 'welcome' } | { kind: 'file'; project: string; path: string } | { kind: 'terminal'; project: string; path: string; session?: string };

const WELCOME: Route = { kind: 'welcome' };
const MAX_EXPANDED = 2000;

const isRoute = (x: unknown): x is Route => {
  const r = x as { kind?: unknown; project?: unknown; path?: unknown; session?: unknown } | null;
  if (!r || typeof r !== 'object') return false;
  if (r.kind === 'welcome') return true;
  if (typeof r.project !== 'string' || typeof r.path !== 'string') return false;
  return r.kind === 'file' || (r.kind === 'terminal' && (r.session === undefined || typeof r.session === 'string'));
};

type MarkdownMode = NonNullable<ExplorerSettings['markdownMode']>;
const MARKDOWN_MODES: readonly string[] = ['live', 'edit', 'split', 'preview'];

interface State {
  sizes: [number, number];
  collapsed: boolean;
  expanded: Record<string, string[]>;
  /** Saved project ids shown in the sidebar; `shownIds` resolves them against the project list. */
  trees: string[];
  treeSizes?: [number, number];
  markdownMode: MarkdownMode;
  wrapLines: boolean;
  layout: Layout<Route>;
}

function initialState(saved: ExplorerSettings | undefined): State {
  const expanded: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(saved?.expanded ?? {})) {
    if (Array.isArray(ids)) expanded[id] = ids.filter((x): x is string => typeof x === 'string');
  }
  const sizes = saved?.sizes;
  return {
    sizes: Array.isArray(sizes) && sizes.length === 2 && sizes.every((n) => typeof n === 'number') ? [sizes[0], sizes[1]] : [0.25, 0.75],
    collapsed: saved?.collapsed === true,
    expanded,
    trees: Array.isArray(saved?.trees) ? saved.trees.filter((x): x is string => typeof x === 'string').slice(0, 2) : [],
    treeSizes: saved?.treeSizes,
    markdownMode: MARKDOWN_MODES.includes(saved?.markdownMode as MarkdownMode) ? saved!.markdownMode! : 'live',
    wrapLines: saved?.wrapLines !== false,
    layout: restore(saved?.tabs, isRoute) ?? singlePane(newTab<Route>(WELCOME)),
  };
}

/** Id of the project the sidebar shows: the saved one, else the first with expanded folders, else the first project. */
function shownId(state: State, list: Project[]): string | undefined {
  const saved = list.find((p) => p.id === state.trees[0]);
  return (saved ?? list.find((p) => state.expanded[p.id]) ?? list[0])?.id;
}

/** Projects shown in the sidebar, 1 or 2: the first as `shownId`, the second when saved and still listed. */
function shownIds(state: State, list: Project[]): string[] {
  const first = shownId(state, list);
  if (!first) return [];
  const second = list.find((p) => p.id === state.trees[1]);
  return second ? [first, second.id] : [first];
}

const sessionIds = (layout: Layout<Route>) =>
  new Set(layout.panes.flatMap((p) => p.tabs.flatMap((tab) => (tab.route.kind === 'terminal' && tab.route.session ? [tab.route.session] : []))));

const fresh = () => newTab<Route>(WELCOME);

/** `fn` applied to the route of every tab and to its history. */
function mapRoutes(layout: Layout<Route>, fn: (route: Route) => Route): Layout<Route> {
  return {
    ...layout,
    panes: layout.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => ({ ...tab, route: fn(tab.route), back: tab.back.map(fn), forward: tab.forward.map(fn) })),
    })),
  };
}

function closeTabsWhere(layout: Layout<Route>, matches: (route: Route) => boolean): Layout<Route> {
  let next = layout;
  for (const pane of layout.panes) {
    for (const tab of pane.tabs) if (matches(tab.route)) next = closeTab(next, tab.id, fresh);
  }
  return next;
}

/** Ids of `project` under `path`, the folder itself included. */
const idsUnder = (project: string, path: string) => (id: string) => id.startsWith(`${project}:`) && relPath.isUnder(id.slice(project.length + 1), path);

export function ExplorerScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const projects = useAsync(() => api.projects(), []);
  const list = projects.data ?? [];
  const [state, setState] = useState(() => initialState(settings.explorer));
  const latest = useRef(state);
  const [form, setForm] = useState<{ project?: Project }>();
  const [formError, setFormError] = useState<ApiError>();
  const [actionError, setActionError] = useState<ApiError>();
  const [focusedTree, setFocusedTree] = useState<0 | 1>(0);
  const copyPath = useCopyPath();
  const undo = useFileUndo();

  const persist = useDebouncedSave((s: State) =>
    onSave({
      explorer: {
        sizes: s.sizes,
        collapsed: s.collapsed,
        expanded: s.expanded,
        ...(s.trees.length > 0 && { trees: s.trees }),
        ...(s.treeSizes && { treeSizes: s.treeSizes }),
        markdownMode: s.markdownMode,
        wrapLines: s.wrapLines,
        tabs: serialize(s.layout),
      },
    }),
  );
  const files = fileSettingsOf(settings.files);
  const [logs, setLogs] = useState<LogSettings | undefined>(settings.logs);
  const saveLogs = useDebouncedSave((l: LogSettings) => onSave({ logs: l }));
  const changeLogs = (next: LogSettings) => {
    setLogs(next);
    saveLogs(next);
  };
  const update = (fn: (s: State) => State) => {
    const next = fn(latest.current);
    const kept = sessionIds(next.layout);
    for (const id of sessionIds(latest.current.layout)) if (!kept.has(id)) void closeSession(id).catch(() => {});
    latest.current = next;
    setState(next);
    persist(next);
  };
  const setExpanded = (project: string, ids: string[]) =>
    update((s) => ({ ...s, expanded: { ...s.expanded, [project]: ids.slice(-MAX_EXPANDED) } }));

  /** Shows `id` in tree `at`, expanding its root the first time. */
  const pickProject = (id: string, at = 0) =>
    update((s) => {
      const shown = shownIds(s, list);
      return {
        ...s,
        trees: at === 0 ? [id, ...shown.slice(1)] : [shown[0] ?? id, id],
        expanded: s.expanded[id] ? s.expanded : { ...s.expanded, [id]: [nodeId(id, '')] },
      };
    });

  /** Shows a second tree below, on the project after the first (the same one when it is the only one). */
  const splitTree = () =>
    update((s) => {
      const shown = shownIds(s, list);
      if (shown.length !== 1) return s;
      const next = list[(list.findIndex((p) => p.id === shown[0]) + 1) % list.length];
      return { ...s, trees: [shown[0], next.id], expanded: s.expanded[next.id] ? s.expanded : { ...s.expanded, [next.id]: [nodeId(next.id, '')] } };
    });

  const closeSecondTree = () => {
    setFocusedTree(0);
    update((s) => ({ ...s, trees: shownIds(s, list).slice(0, 1) }));
  };

  /** Opens a file; `preview` opens it in the pane's preview tab, which a later preview replaces. An already open file is only shown (and kept open unless `preview`). */
  const openFile = (project: string, path: string, preview = false) =>
    update((s) => {
      const target: Route = { kind: 'file', project, path };
      for (const pane of s.layout.panes) {
        const same = pane.tabs.find((x) => x.route.kind === 'file' && x.route.project === project && x.route.path === path);
        if (same) {
          const shown = activate(s.layout, pane.id, same.id);
          return { ...s, layout: preview ? shown : pinTab(shown, same.id) };
        }
      }
      const pane = focusedPane(s.layout);
      const slot = preview ? pane.tabs.find((x) => x.preview) : undefined;
      if (slot) return { ...s, layout: activate(navigate(s.layout, slot.id, target, { replace: true }), pane.id, slot.id) };
      const current = activeTab(s.layout);
      if (current.route.kind === 'welcome') {
        const layout = navigate(s.layout, current.id, target, { replace: true });
        return { ...s, layout: preview ? setPreview(layout, current.id, true) : layout };
      }
      const tab = newTab(target);
      return { ...s, layout: addTab(s.layout, preview ? { ...tab, preview: true } : tab) };
    });

  const openFileToSide = (project: string, path: string) =>
    update((s) => ({ ...s, layout: openBeside(s.layout, newTab<Route>({ kind: 'file', project, path })) }));

  const openTerminal = (project: string, path: string) =>
    update((s) => {
      const target: Route = { kind: 'terminal', project, path };
      const current = activeTab(s.layout);
      const layout = current.route.kind === 'welcome' ? navigate(s.layout, current.id, target, { replace: true }) : addTab(s.layout, newTab(target));
      return { ...s, layout };
    });

  const onSession = (tabId: string, session: string) => {
    const tab = latest.current.layout.panes.flatMap((p) => p.tabs).find((x) => x.id === tabId);
    if (!tab || tab.route.kind !== 'terminal' || tab.route.session === session) return;
    const route = tab.route;
    update((s) => ({ ...s, layout: navigate(s.layout, tabId, { ...route, session }, { replace: true }) }));
  };

  // Open tabs and expanded folders follow a rename or move.
  const moved = (project: string, from: string, to: string) =>
    update((s) => ({
      ...s,
      layout: mapRoutes(s.layout, (r) => (r.kind === 'file' && r.project === project && relPath.isUnder(r.path, from) ? { ...r, path: relPath.moved(r.path, from, to) } : r)),
      expanded: s.expanded[project]
        ? {
            ...s.expanded,
            [project]: s.expanded[project].map((id) => (idsUnder(project, from)(id) ? nodeId(project, relPath.moved(id.slice(project.length + 1), from, to)) : id)),
          }
        : s.expanded,
    }));

  const dirtyCount = (project: string, paths: string[]) =>
    latest.current.layout.panes
      .flatMap((p) => p.tabs)
      .filter((x) => x.dirty && x.route.kind === 'file' && x.route.project === project && paths.some((path) => relPath.isUnder(x.route.kind === 'file' ? x.route.path : '', path))).length;

  const deleted = (project: string, path: string) =>
    update((s) => ({
      ...s,
      layout: closeTabsWhere(s.layout, (r) => r.kind === 'file' && r.project === project && relPath.isUnder(r.path, path)),
      expanded: s.expanded[project] ? { ...s.expanded, [project]: s.expanded[project].filter((id) => !idsUnder(project, path)(id)) } : s.expanded,
    }));

  const removeProject = async (project: Project) => {
    setActionError(undefined);
    try {
      await api.deleteProject(project.id);
    } catch (err) {
      setActionError(errorOf(err));
      return;
    }
    const at = list.findIndex((p) => p.id === project.id);
    const next = list[at + 1] ?? list[at - 1];
    update((s) => {
      const { [project.id]: _removed, ...expanded } = s.expanded;
      const rest = s.trees.filter((x) => x !== project.id);
      const shownRemoved = s.trees[0] === project.id || (s.trees.length === 0 && shownId(s, list) === project.id);
      const trees = shownRemoved && next ? [next.id, ...rest] : rest;
      if (shownRemoved && next && !expanded[next.id]) expanded[next.id] = [nodeId(next.id, '')];
      return { ...s, expanded, trees, layout: closeTabsWhere(s.layout, (r) => r.kind === 'file' && r.project === project.id) };
    });
    projects.reload();
  };

  const submitForm = async (values: Record<string, unknown>) => {
    if (!form) return;
    setFormError(undefined);
    try {
      const saved = form.project ? await api.updateProject(form.project.id, values) : await api.createProject(values);
      setForm(undefined);
      projects.reload();
      if (!form.project) pickProject(saved.id, focus);
    } catch (err) {
      setFormError(errorOf(err));
    }
  };

  const fields: FieldSpec[] = [
    { key: 'name', label: t('explorer.projectName'), kind: 'text', required: true },
    { key: 'path', label: t('explorer.projectPath'), kind: 'path', required: true },
  ];

  const nameOf = (id: string) => list.find((p) => p.id === id)?.name ?? id;
  const titleOf = (route: Route) =>
    route.kind === 'welcome'
      ? { title: t('explorer.welcome') }
      : route.kind === 'terminal'
        ? { title: `${t('terminalScreen.tab')} · ${relPath.basename(route.path) || nameOf(route.project)}`, icon: 'terminal' as const }
        : {
          title: relPath.basename(route.path),
          tooltip: `${nameOf(route.project)}/${route.path}`,
          location: [nameOf(route.project), relPath.dirname(route.path)].filter(Boolean).join('/'),
          ...fileIconOf(relPath.basename(route.path)),
        };

  const menuOf = (route: Route): ContextMenuItem[] => {
    const project = route.kind === 'file' ? list.find((p) => p.id === route.project) : undefined;
    if (route.kind !== 'file' || !project) return [];
    return [
      { id: 'revealInTree', label: t('explorer.revealInTree'), icon: 'locate', run: () => revealFile(route.project, route.path) },
      { id: 'copyFullPath', label: t('explorer.copyFullPath'), icon: 'copy', run: () => copyPath(fullPath(project.path, route.path)) },
      { id: 'copyPath', label: t('explorer.copyPath'), icon: 'copy', run: () => copyPath(route.path) },
    ];
  };

  const shown = shownIds(state, list).flatMap((id) => list.find((p) => p.id === id) ?? []);
  const focus = shown.length > 1 ? focusedTree : 0;

  const trees = useRef<Array<ProjectTreeApi | null>>([]);
  const revealRequest = useRef<{ project: string; path: string }>();
  const [revealTick, setRevealTick] = useState(0);
  const active = activeTab(state.layout).route;
  const activeFile = active.kind === 'file' ? active : undefined;
  const shownKey = shown.map((p) => p.id).join(',');
  const revealIn = (project: string, path: string) => {
    const at = shown.findIndex((p) => p.id === project);
    if (at < 0) return false;
    trees.current[at]?.reveal(path);
    return true;
  };
  const revealFile = (project: string, path: string) => {
    revealRequest.current = { project, path };
    if (!shown.some((p) => p.id === project)) pickProject(project, focus);
    setRevealTick((n) => n + 1);
  };
  useCommand(commandById('explorer.revealInTree'), () => activeFile && revealFile(activeFile.project, activeFile.path), { enabled: !!activeFile });

  useEffect(() => {
    const request = revealRequest.current;
    if (request) {
      if (revealIn(request.project, request.path)) revealRequest.current = undefined;
      return;
    }
    if (!files.autoReveal || !activeFile || /(^|\/)(node_modules|\.git)(\/|$)/.test(activeFile.path)) return;
    revealIn(activeFile.project, activeFile.path);
  }, [activeFile?.project, activeFile?.path, shownKey, revealTick, files.autoReveal]);

  const pickerHandlers = {
    onAdd: () => {
      setFormError(undefined);
      setForm({});
    },
    onEdit: (p: Project) => {
      setFormError(undefined);
      setForm({ project: p });
    },
    onRemove: (p: Project) => void removeProject(p),
  };

  const sidebar = (
    <>
      {actionError && <ErrorBanner error={actionError} compact />}
      {projects.error && <ErrorBanner error={projects.error} onRetry={projects.reload} />}
      {projects.loading && !projects.data ? (
        <div className="xp-loading"><Spinner small /></div>
      ) : (
        <>
          {shown.length === 0 ? (
            <ProjectPicker projects={list} current={undefined} {...pickerHandlers} onPick={(p) => pickProject(p.id)} />
          ) : (
            <SplitView
              direction="column"
              sizes={shown.length > 1 ? (state.treeSizes ?? [0.5, 0.5]) : [1]}
              defaultSizes={[0.5, 0.5]}
              min={[120, 120]}
              onResize={(sizes) => shown.length > 1 && update((s) => ({ ...s, treeSizes: [sizes[0], sizes[1]] }))}
            >
              {shown.map((project, i) => (
                <TreePane
                  key={`${i}:${project.id}`}
                  project={project}
                  projects={list}
                  focused={focus === i}
                  exclude={files.exclude}
                  compact={files.compactFolders}
                  nesting={files.fileNesting ? files.nestingPatterns : undefined}
                  sort={files.sortOrder}
                  onFocus={() => setFocusedTree(i as 0 | 1)}
                  onPick={(p) => pickProject(p.id, i)}
                  {...pickerHandlers}
                  expanded={state.expanded[project.id] ?? [nodeId(project.id, '')]}
                  onExpandedChange={(ids) => setExpanded(project.id, ids)}
                  onOpenFile={(p, path) => openFile(p, path)}
                  apiRef={(h) => void (trees.current[i] = h)}
                  onOpenFileToSide={openFileToSide}
                  onPreviewFile={files.previewTabs ? (p, path) => openFile(p, path, true) : undefined}
                  onOpenTerminal={openTerminal}
                  onMoved={moved}
                  onDeleted={deleted}
                  undo={undo}
                  dirtyCount={dirtyCount}
                  actions={
                    i === 0 && shown.length === 1 ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={splitTree} title={t('explorer.split')} aria-label={t('explorer.split')}>
                        <Icon name="split-down" />
                      </button>
                    ) : i === 1 ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={closeSecondTree} title={t('explorer.closeTree')} aria-label={t('explorer.closeTree')}>
                        <Icon name="close" />
                      </button>
                    ) : undefined
                  }
                />
              ))}
            </SplitView>
          )}
        </>
      )}
    </>
  );

  return (
    <>
      <Explorer
        sidebar={sidebar}
        sizes={state.sizes}
        onResize={(sizes) => update((s) => ({ ...s, sizes }))}
        collapsed={state.collapsed}
        onCollapsedChange={(collapsed) => update((s) => ({ ...s, collapsed }))}
        scope="explorer"
      >
        <TabWorkspace
          layout={state.layout}
          onChange={(layout) => update((s) => ({ ...s, layout }))}
          titleOf={titleOf}
          menuOf={menuOf}
          newRoute={() => WELCOME}
          scope="explorer"
          renderTab={(tab, ctx) =>
            tab.route.kind === 'file' ? (
              <Suspense fallback={<PanelLoading />}>
                <FileTab project={tab.route.project} projectName={nameOf(tab.route.project)} path={tab.route.path} focused={ctx.focused} logs={logs} onLogsChange={changeLogs} onDirty={ctx.setDirty} onSaver={ctx.setSaver} onActions={ctx.setActions}markdownMode={state.markdownMode} onMarkdownModeChange={(markdownMode) => update((s) => ({ ...s, markdownMode }))} wrapLines={state.wrapLines} onWrapLinesChange={(wrapLines) => update((s) => ({ ...s, wrapLines }))} files={files} onOpenPath={(p) => tab.route.kind === 'file' && openFile(tab.route.project, p, files.previewTabs)} />
              </Suspense>
            ) : tab.route.kind === 'terminal' ? (
              <Suspense fallback={<PanelLoading />}>
                <TerminalPane
                  session={tab.route.session}
                  cwd={{ root: tab.route.project, path: tab.route.path }}
                  onSession={(id) => onSession(tab.id, id)}
                />
              </Suspense>
            ) : (
              <Welcome projects={list} onOpen={pickProject} />
            )
          }
        />
      </Explorer>
      {form && (
        <Modal title={t(form.project ? 'explorer.projectEdit' : 'explorer.projectAdd')} onClose={() => setForm(undefined)}>
          <ResourceForm
            fields={fields}
            value={{ ...form.project }}
            error={formError}
            onCancel={() => setForm(undefined)}
            onBrowse={() => dialogs.pickFolder({ title: t('explorer.pickFolder') })}
            onSubmit={(values) => void submitForm(values)}
          />
        </Modal>
      )}
    </>
  );
}

function Welcome({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  return (
    <div className="content">
      <PageHead crumb={t('explorer.crumb')} title={t('explorer.welcome')} />
      <div className="scroll">
        <Empty title={t('explorer.welcomeTitle')}>
          <p className="muted">{t('explorer.welcomeHint')}</p>
        </Empty>
        {projects.length > 0 && (
          <div className="chips">
            {projects.map((p) => (
              <button key={p.id} className="chip" onClick={() => onOpen(p.id)}>{p.name}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
