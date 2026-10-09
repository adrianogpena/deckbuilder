import { lazy, Suspense, useRef, useState } from 'react';
import {
  activate,
  activeTab,
  addTab,
  closeTab,
  dialogs,
  Empty,
  errorOf,
  ErrorBanner,
  Explorer,
  type ApiError,
  type FieldSpec,
  Modal,
  navigate,
  newTab,
  PageHead,
  PanelLoading,
  ResourceForm,
  ResourceList,
  restore,
  serialize,
  singlePane,
  Spinner,
  TabWorkspace,
  useAsync,
  useDebouncedSave,
  type Layout,
  fileIconOf,
  relPath,
} from '@deckbuilder/ui';
import { api, type ExplorerSettings, type LogSettings, type Project, type Settings } from '../api';
import { nodeId } from '../explorer-paths';
import { t } from '../i18n';
import { ProjectTree } from './explorer/ProjectTree';

// The editor and viewers are large; they load when the first file opens.
const FileTab = lazy(() => import('./explorer/FileTab').then((m) => ({ default: m.FileTab })));

type Route = { kind: 'welcome' } | { kind: 'file'; project: string; path: string };

const WELCOME: Route = { kind: 'welcome' };
const MAX_EXPANDED = 2000;

const isRoute = (x: unknown): x is Route => {
  const r = x as { kind?: unknown; project?: unknown; path?: unknown } | null;
  if (!r || typeof r !== 'object') return false;
  return r.kind === 'welcome' || (r.kind === 'file' && typeof r.project === 'string' && typeof r.path === 'string');
};

interface State {
  sizes: [number, number];
  collapsed: boolean;
  expanded: Record<string, string[]>;
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
    layout: restore(saved?.tabs, isRoute) ?? singlePane(newTab<Route>(WELCOME)),
  };
}

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

  const persist = useDebouncedSave((s: State) =>
    onSave({ explorer: { sizes: s.sizes, collapsed: s.collapsed, expanded: s.expanded, tabs: serialize(s.layout) } }),
  );
  const [logs, setLogs] = useState<LogSettings | undefined>(settings.logs);
  const saveLogs = useDebouncedSave((l: LogSettings) => onSave({ logs: l }));
  const changeLogs = (next: LogSettings) => {
    setLogs(next);
    saveLogs(next);
  };
  const update = (fn: (s: State) => State) => {
    const next = fn(latest.current);
    latest.current = next;
    setState(next);
    persist(next);
  };
  const setExpanded = (project: string, ids: string[]) =>
    update((s) => ({ ...s, expanded: { ...s.expanded, [project]: ids.slice(-MAX_EXPANDED) } }));

  const openProject = (id: string) =>
    update((s) => (s.expanded[id] ? s : { ...s, expanded: { ...s.expanded, [id]: [nodeId(id, '')] } }));

  const closeProject = (id: string) =>
    update((s) => {
      const { [id]: _closed, ...expanded } = s.expanded;
      return { ...s, expanded };
    });

  const openFile = (project: string, path: string) =>
    update((s) => {
      const target: Route = { kind: 'file', project, path };
      for (const pane of s.layout.panes) {
        const same = pane.tabs.find((x) => x.route.kind === 'file' && x.route.project === project && x.route.path === path);
        if (same) return { ...s, layout: activate(s.layout, pane.id, same.id) };
      }
      const current = activeTab(s.layout);
      const layout = current.route.kind === 'welcome' ? navigate(s.layout, current.id, target, { replace: true }) : addTab(s.layout, newTab(target));
      return { ...s, layout };
    });

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
    update((s) => {
      const { [project.id]: _removed, ...expanded } = s.expanded;
      return { ...s, expanded, layout: closeTabsWhere(s.layout, (r) => r.kind === 'file' && r.project === project.id) };
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
      if (!form.project) openProject(saved.id);
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
      : {
          title: relPath.basename(route.path),
          tooltip: `${nameOf(route.project)}/${route.path}`,
          ...fileIconOf(relPath.basename(route.path)),
        };

  const sidebar = (
    <>
      {actionError && <ErrorBanner error={actionError} compact />}
      {projects.error && <ErrorBanner error={projects.error} onRetry={projects.reload} />}
      {projects.loading && !projects.data ? (
        <div className="xp-loading"><Spinner small /></div>
      ) : (
        <ResourceList
          items={list}
          titleOf={(p) => p.name}
          subtitleOf={(p) => p.path}
          iconOf={() => 'folder'}
          onOpen={(p) => openProject(p.id)}
          onEdit={(p) => {
            setFormError(undefined);
            setForm({ project: p });
          }}
          onDelete={(p) => void removeProject(p)}
          onAdd={() => {
            setFormError(undefined);
            setForm({});
          }}
          emptyTitle={t('explorer.noProjects')}
          deleteBodyOf={(p) => t('explorer.deleteProjectBody', { name: p.name })}
        />
      )}
      {list
        .filter((p) => state.expanded[p.id])
        .map((p) => (
          <ProjectTree
            key={p.id}
            project={p}
            expanded={state.expanded[p.id] ?? []}
            onExpandedChange={(ids) => setExpanded(p.id, ids)}
            onOpenFile={openFile}
            onMoved={moved}
            onDeleted={deleted}
            onClose={() => closeProject(p.id)}
          />
        ))}
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
          newRoute={() => WELCOME}
          scope="explorer"
          renderTab={(tab, ctx) =>
            tab.route.kind === 'file' ? (
              <Suspense fallback={<PanelLoading />}>
                <FileTab project={tab.route.project} projectName={nameOf(tab.route.project)} path={tab.route.path} focused={ctx.focused} logs={logs} onLogsChange={changeLogs} />
              </Suspense>
            ) : (
              <Welcome projects={list} onOpen={openProject} />
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
