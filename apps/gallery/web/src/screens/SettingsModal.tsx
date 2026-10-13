import { Fragment, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { formatSql } from '@deckbuilder/editor';
import { AppearanceFields, SettingRow, fileSettingsOf, ZoomField, type ApiError, detectLanguage, type FileAssociation, validFileAssociations, ErrorBanner, errorMessage, errorOf, Icon, isDesktop, LANGUAGES, Modal, Spinner, useAsync, type Language } from '@deckbuilder/ui';
import { APP } from '../../../app';
import { api, type BackupInfo, type EditorInfo, type Project, type ImportResult, type Settings, type SqlFormatOptions, withWorkbenchDefaults } from '../api';
import { type MessageKey, t } from '../i18n';
import { settingsRegistry } from '../settings';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

const SECTIONS = [
  { id: 'general', label: 'settings.general' },
  { id: 'layout', label: 'settings.layout' },
  { id: 'explorer', label: 'settings.explorer' },
  { id: 'workbench', label: 'settings.workbench' },
  { id: 'editor', label: 'settings.editor' },
  { id: 'files', label: 'settings.files' },
  { id: 'editors', label: 'settings.editors' },
  { id: 'terminal', label: 'settings.terminal' },
  { id: 'updates', label: 'settings.updates' },
  { id: 'backup', label: 'settings.backup' },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;
type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * Settings as VS Code opens them: a modal editor over the current screen, closed with Escape or a click outside.
 * The keybindings have a screen of their own (`KeysScreen`), linked from the section list.
 */
export function SettingsModal({ settings, onChange, onQuit, onClose, onOpenKeys }: Props & { onClose: () => void; onOpenKeys: () => void }) {
  const [section, setSection] = useState<SectionId>('general');
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';
  const hits = useSettingsFilter(body, searching ? query : '');
  const render = (id: SectionId): ReactNode => {
    switch (id) {
      case 'general': return <GeneralSection settings={settings} onChange={onChange} onQuit={onQuit} />;
      case 'layout':
        return (
          <section className="section">
            <div className="card form">
              <ZoomField value={settings} onChange={onChange} />
            </div>
          </section>
        );
      case 'explorer': return <ExplorerCard settings={settings} onChange={onChange} />;
      case 'workbench': return <WorkbenchCard settings={settings} onChange={onChange} />;
      case 'editor': return <EditorCard settings={settings} onChange={onChange} />;
      case 'files': return <FileTypesCard value={settings.fileAssociations ?? []} onChange={(fileAssociations) => onChange({ fileAssociations })} />;
      case 'editors': return <EditorsCard />;
      case 'terminal': return <TerminalCard shell={settings.terminal?.shell ?? 'auto'} onShell={(shell) => onChange({ terminal: { shell } })} />;
      case 'updates': return <UpdatesCard folder={settings.updateFolder} onFolder={(updateFolder) => onChange({ updateFolder })} />;
      case 'backup': return <BackupCard onSettings={onChange} />;
    }
  };
  const total = [...hits.values()].reduce((a, n) => a + n, 0);
  return (
    <Modal title={t('settings.title')} onClose={onClose} large>
      <div className="settings-header">
        <input
          className="settings-search"
          type="search"
          value={query}
          placeholder={t('settings.search')}
          aria-label={t('settings.search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              setQuery('');
            } else if (e.key === 'ArrowDown') {
              // Like VS Code: down from the search box goes into the settings.
              const first = body.current?.querySelector<HTMLElement>(`.field:not([hidden]) :is(${CONTROLS})`);
              if (first) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        />
        {searching && <span className="settings-count">{t(total === 1 ? 'settings.search.count.one' : 'settings.search.count', { n: total })}</span>}
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item${!searching && section === s.id ? ' active' : ''}`}
              aria-current={!searching && section === s.id}
              hidden={searching && !hits.has(s.id)}
              onClick={() => {
                setQuery('');
                setSection(s.id);
                body.current?.scrollTo({ top: 0 });
              }}
            >
              {t(s.label)}
              {searching && <span className="settings-nav-count">{hits.get(s.id)}</span>}
            </button>
          ))}
          <div className="settings-nav-sep" />
          <button className="settings-nav-item settings-nav-link" onClick={onOpenKeys}>
            <Icon name="key" />
            {t('settings.keys')}
          </button>
        </nav>
        <div className="scroll" ref={body}>
          {searching
            ? SECTIONS.map((s) => (
                <div key={s.id} className="settings-group" data-section={s.id} data-title={t(s.label)}>
                  <h3 className="settings-group-title">{t(s.label)}</h3>
                  {render(s.id)}
                </div>
              ))
            : (
                // Keyed apart from the search groups, so leaving a search remounts rows the filter hid.
                <div key={`page-${section}`} className="settings-page">
                  <h3 className="settings-group-title">{t(SECTIONS.find((s) => s.id === section)!.label)}</h3>
                  {render(section)}
                </div>
              )}
          {searching && hits.size === 0 && (
            <div className="settings-empty">
              <span className="muted">{t('settings.search.none')}</span>
              <button className="btn btn-sm" onClick={() => setQuery('')}>{t('settings.search.clear')}</button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** One schema setting rendered as a row. */
function Row({ id, settings, onChange }: { id: string; settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  return <SettingRow def={settingsRegistry.setting(id)!} settings={settings} onChange={onChange} />;
}

// What ArrowDown in the search box focuses first.
const CONTROLS = 'input, select, textarea, button';

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase().replace(/\s+/g, ' ');

/**
 * Filters the rendered settings while searching, like VS Code's settings search: a `.field` row stays when its
 * label (`.mono-label`) or description (`.muted`, also a checkbox's) holds every word; cards, sections and groups
 * with no row left hide. A group whose title matches keeps all its rows. It works on the DOM, so the hand-written
 * rows need no wiring, and re-runs when async cards (editors, updates, backup) fill in. Returns the number of
 * matching rows per section with hits.
 */
function useSettingsFilter(root: RefObject<HTMLElement | null>, query: string): Map<string, number> {
  const [hits, setHits] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    const el = root.current;
    const words = norm(query).trim().split(' ').filter(Boolean);
    if (!el || words.length === 0) {
      setHits((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const apply = () => {
      const found = new Map<string, number>();
      for (const group of el.querySelectorAll<HTMLElement>('.settings-group')) {
        const whole = words.every((w) => norm(group.dataset.title).includes(w));
        for (const field of group.querySelectorAll<HTMLElement>('.field')) {
          const text = norm([...field.querySelectorAll(':scope > .mono-label, :scope > .muted, :scope > .setting-check > .muted')].map((n) => n.textContent).join(' '));
          field.hidden = !(whole || words.every((w) => text.includes(w)));
        }
        // Innermost first, so a section sees its cards' final state.
        for (const box of [...group.querySelectorAll<HTMLElement>('.card, .section')].reverse()) {
          box.hidden = box.querySelector('.field') ? !box.querySelector('.field:not([hidden])') : !whole;
        }
        const rows = group.querySelectorAll('.field:not([hidden])').length;
        const any = whole || rows > 0;
        group.hidden = !any;
        if (any && group.dataset.section) found.set(group.dataset.section, rows);
      }
      setHits((prev) => (prev.size === found.size && [...found].every(([s, n]) => prev.get(s) === n) ? prev : found));
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [root, query]);
  return hits;
}

function GeneralSection({ settings, onChange, onQuit }: Props) {
  return (
    <>
      <section className="section">
        <h4 className="mono-label">{t('settings.theme')}</h4>
        <div className="card form">
          <AppearanceFields value={settings} onChange={onChange} />
        </div>
      </section>
      <div className="card form">
        <label className="field">
          <span className="mono-label">{t('settings.language')}</span>
          <select value={settings.language ?? detectLanguage()} onChange={(e) => onChange({ language: e.target.value as Language })}>
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <Row id="general.autostart" settings={settings} onChange={onChange} />
        <Row id="general.closeToTray" settings={settings} onChange={onChange} />
      </div>
      {(!isDesktop || settings.closeToTray) && <GeneralCard onQuit={onQuit} />}
    </>
  );
}

/** Saving text files, like VS Code's `files.*` settings; the Explorer's file tabs read them. */
function EditorCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.saving')}</h4>
      <div className="card form">
        <Row id="files.autoSave" settings={settings} onChange={onChange} />
        <Row id="files.trimTrailingWhitespace" settings={settings} onChange={onChange} />
        <Row id="files.insertFinalNewline" settings={settings} onChange={onChange} />
      </div>
    </section>
  );
}

/** How the Explorer tree and its tabs behave (`files.*` settings, shared with the file tabs). */
function ExplorerCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const files = fileSettingsOf(settings.files);
  const set = (patch: Partial<typeof files>) => onChange({ files: { ...files, ...patch } });
  return (
    <>
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.tabs')}</h4>
      <div className="card form">
        <Row id="files.previewTabs" settings={settings} onChange={onChange} />
        <Row id="files.autoReveal" settings={settings} onChange={onChange} />
        <Row id="files.breadcrumbs" settings={settings} onChange={onChange} />
      </div>
    </section>
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.view')}</h4>
      <div className="card form">
        <Row id="files.compactFolders" settings={settings} onChange={onChange} />
        <Row id="files.sortOrder" settings={settings} onChange={onChange} />
        <Row id="files.fileNesting" settings={settings} onChange={onChange} />
        {files.fileNesting && <NestingField value={files.nestingPatterns} onChange={(nestingPatterns) => set({ nestingPatterns })} />}
        <ExcludeField value={files.exclude} onChange={(exclude) => set({ exclude })} />
      </div>
    </section>
    </>
  );
}

const FORMAT_GROUPS: ReadonlyArray<{ id: string; keys: ReadonlyArray<keyof SqlFormatOptions> }> = [
  { id: 'case', keys: ['keywordCase', 'functionCase'] },
  { id: 'select', keys: ['columnsPerLine', 'newlineAfterSelect', 'singleColumnInline'] },
  { id: 'conditions', keys: ['conditionPerLine', 'andOrPosition', 'joinConditionOnNewLine', 'spaceAroundOperators'] },
  { id: 'subqueries', keys: ['caseLayout', 'caseMaxWidth', 'subqueryNewlineAfterParen', 'subqueryCloseParenOnOwnLine'] },
  { id: 'statements', keys: ['indent', 'groupOrderListPerLine', 'fromTablesPerLine', 'setItemsPerLine', 'blankLineBetweenStatements'] },
];

const FORMAT_SAMPLE =
  "select e.id, e.name, lower(d.title) as dept, case when e.salary > 5000 then 'high' else 'low' end as band from employees e join departments d on d.id = e.dept_id where e.active = 1 and d.region in (select region from regions where code = 'EU') order by e.name;\nupdate employees set salary = salary * 1.1, updated = sysdate where dept_id = 10;";

/** Allowed projects as a short list with remove buttons, and a searchable "add" list for the rest. */
function ProjectsField({ projects, error, onRetry, value, onChange }: {
  projects: Project[] | undefined;
  error: ApiError | undefined;
  onRetry: () => void;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const allowed = projects?.filter((p) => value.includes(p.id)) ?? [];
  const q = norm(query);
  const candidates = projects?.filter((p) => !value.includes(p.id) && (!q || norm(p.name).includes(q) || norm(p.path).includes(q))) ?? [];
  const add = (id: string) => {
    onChange([...value, id]);
    setAdding(false);
    setQuery('');
  };
  return (
    <div className="field">
      <span className="mono-label">{t('settings.workbench.projects')}</span>
      {error && <ErrorBanner error={error} onRetry={onRetry} compact />}
      {!projects && !error && <Spinner small />}
      {projects?.length === 0 && <span className="muted">{t('settings.workbench.projects.none')}</span>}
      {projects && allowed.length === 0 && projects.length > 0 && <span className="muted">{t('settings.workbench.projects.empty')}</span>}
      {allowed.map((p) => (
        <div key={p.id} className="check-row">
          <span>{p.name}</span>
          <button className="btn btn-sm" onClick={() => onChange(value.filter((id) => id !== p.id))}>{t('settings.workbench.projects.remove')}</button>
        </div>
      ))}
      {projects && projects.length > allowed.length && (adding ? (
        <>
          <input autoFocus value={query} placeholder={t('settings.workbench.projects.search')} spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          <div className="project-add-list">
            {candidates.length === 0 && <span className="muted">{t('settings.workbench.projects.noMatch')}</span>}
            {candidates.map((p) => (
              <button key={p.id} className="menu-item" onClick={() => add(p.id)}>
                <span className="menu-label">{p.name}</span>
                <span className="muted">{p.path}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>{t('settings.workbench.projects.add')}</button>
      ))}
      <span className="muted">{t('settings.workbench.projects.hint')}</span>
    </div>
  );
}

/** Which projects run SQL from the Explorer, how result cells read, and the SQL formatter options with a live preview. */
function WorkbenchCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const projects = useAsync(() => api.projects(), []);
  const wb = withWorkbenchDefaults(settings.workbench);
  const preview = useMemo(() => {
    try {
      return formatSql(FORMAT_SAMPLE, wb.format);
    } catch {
      return FORMAT_SAMPLE;
    }
  }, [wb.format]);
  return (
    <>
      <section className="section">
        <h4 className="mono-label">{t('settings.workbench.sql')}</h4>
        <div className="card form">
          <ProjectsField
            projects={projects.data}
            error={projects.error}
            onRetry={projects.reload}
            value={wb.explorerProjects}
            onChange={(explorerProjects) => onChange({ workbench: { ...wb, explorerProjects } })}
          />
          <Row id="workbench.maxRows" settings={settings} onChange={onChange} />
        </div>
      </section>
      <section className="section">
        <h4 className="mono-label">{t('settings.workbench.results')}</h4>
        <div className="card form">
          <Row id="workbench.results.nullText" settings={settings} onChange={onChange} />
          <Row id="workbench.results.dateFormat" settings={settings} onChange={onChange} />
          <Row id="workbench.results.hideMidnight" settings={settings} onChange={onChange} />
          <Row id="workbench.results.timestampFormat" settings={settings} onChange={onChange} />
          <Row id="workbench.results.thousandsSeparator" settings={settings} onChange={onChange} />
          <Row id="workbench.copyFormat" settings={settings} onChange={onChange} />
        </div>
      </section>
      {FORMAT_GROUPS.map((group) => (
        <section key={group.id} className="section">
          <h4 className="mono-label">{t(`settings.workbench.group.${group.id}` as MessageKey)}</h4>
          <div className="card form">
            {group.keys.map((key) => <Row key={key} id={`workbench.format.${key}`} settings={settings} onChange={onChange} />)}
          </div>
        </section>
      ))}
      <section className="section">
        <h4 className="mono-label">{t('settings.workbench.preview')}</h4>
        <div className="card form">
          <div className="field">
            <span className="muted">{t('settings.workbench.preview.hint')}</span>
            <pre className="mono">{preview}</pre>
          </div>
        </div>
      </section>
    </>
  );
}

function NestingField({ value, onChange }: { value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const [text, setText] = useState(Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(String.fromCharCode(10)));
  return (
    <div className="field">
      <span className="mono-label">{t('settings.explorer.nesting.patterns')}</span>
      <textarea
        value={text}
        rows={6}
        spellCheck={false}
        aria-label={t('settings.explorer.nesting.patterns')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next: Record<string, string> = {};
          for (const line of text.split(String.fromCharCode(10))) {
            const at = line.indexOf(':');
            const parent = line.slice(0, at).trim();
            const children = line.slice(at + 1).trim();
            if (at > 0 && parent && children) next[parent] = children;
          }
          onChange(next);
        }}
      />
      <span className="muted">{t('settings.explorer.nesting.patterns.hint')}</span>
    </div>
  );
}

function ExcludeField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <div className="field">
      <span className="mono-label">{t('settings.explorer.exclude')}</span>
      <textarea
        value={text}
        rows={4}
        spellCheck={false}
        aria-label={t('settings.explorer.exclude')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split('\n').map((l) => l.trim()).filter(Boolean))}
      />
      <span className="muted">{t('settings.explorer.exclude.hint')}</span>
    </div>
  );
}

/**
 * Where closing the window doesn't stop the app: browser and app mode, and with the tray (the
 * setting, which applies after a restart; until then the tray menu or the close button quits).
 */
function GeneralCard({ onQuit }: { onQuit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const quit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.quit();
      onQuit();
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="card form">
        <div className="field">
          <div className="row">
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={quit}>
              {t('settings.quit')}
            </button>
          </div>
          <span className="muted">{t(isDesktop ? 'settings.quit.hintTray' : 'settings.quit.hint', { name: APP.name })}</span>
        </div>
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}

const ASSOCIATION_TARGETS = ['log', 'txt', 'json', 'md', 'sql', 'xml', 'yaml', 'properties', 'csv', 'html', 'js', 'java', 'sh', 'env', 'zip'] as const;

/** Name patterns opened as another file type; a row applies once its pattern is valid. */
function FileTypesCard({ value, onChange }: { value: FileAssociation[]; onChange: (next: FileAssociation[]) => void }) {
  const [rows, setRows] = useState<FileAssociation[]>(value);
  const update = (next: FileAssociation[]) => {
    setRows(next);
    const valid = validFileAssociations(next.filter((r) => r.pattern.trim()));
    if (valid) onChange(valid);
  };
  const targetLabel = (as: string) => (ASSOCIATION_TARGETS.includes(as as never) ? t(`settings.files.as.${as}` as MessageKey) : `.${as}`);
  return (
    <section className="section">
      <div className="card form">
        <span className="muted">{t('settings.files.hint')}</span>
        {rows.length === 0 && <span className="muted">{t('settings.files.empty')}</span>}
        {rows.map((row, i) => (
          <div key={i} className="row">
            <input
              value={row.pattern}
              placeholder="*.log.*"
              aria-label={t('settings.files.pattern')}
              spellCheck={false}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, pattern: e.target.value } : r)))}
            />
            <select value={row.as} aria-label={t('settings.files.as')} onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, as: e.target.value } : r)))}>
              {!ASSOCIATION_TARGETS.includes(row.as as never) && <option value={row.as}>{targetLabel(row.as)}</option>}
              {ASSOCIATION_TARGETS.map((as) => <option key={as} value={as}>{targetLabel(as)}</option>)}
            </select>
            <button className="btn btn-sm" onClick={() => update(rows.filter((_, j) => j !== i))}>{t('settings.files.remove')}</button>
          </div>
        ))}
        <div className="row">
          <button className="btn btn-sm" onClick={() => setRows([...rows, { pattern: '', as: 'log' }])}>{t('settings.files.add')}</button>
        </div>
      </div>
    </section>
  );
}

/** Product names of the shell ids; not translated. */
const SHELL_NAMES: Record<string, string> = {
  powershell: 'Windows PowerShell',
  pwsh: 'PowerShell 7',
  cmd: 'cmd',
  'git-bash': 'Git Bash',
  wsl: 'WSL',
};

function TerminalCard({ shell, onShell }: { shell: string; onShell: (shell: string) => void }) {
  const shells = useAsync(() => api.terminalShells(), []);
  return (
    <section className="section">
      <div className="card form">
        {shells.error && <ErrorBanner error={shells.error} onRetry={shells.reload} compact />}
        <label className="field">
          <span className="mono-label">{t('settings.terminal.shell')}</span>
          <select value={shell} disabled={!shells.data} onChange={(e) => onShell(e.target.value)}>
            <option value="auto">{t('settings.terminal.auto')}</option>
            {shells.data?.filter((id) => id !== 'auto').map((id) => <option key={id} value={id}>{SHELL_NAMES[id] ?? id}</option>)}
          </select>
          <span className="muted">{t('settings.terminal.hint')}</span>
        </label>
      </div>
    </section>
  );
}

function EditorsCard() {
  const state = useAsync(() => api.editors(), []);
  const [list, setList] = useState<EditorInfo[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = async (job: () => Promise<EditorInfo[]>) => {
    setBusy(true);
    setError(null);
    try {
      setList(await job());
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const editors = list ?? state.data;
  return (
    <section className="section">
      <div className="card form">
        {!editors && !state.error && <Spinner small />}
        {state.error && <ErrorBanner error={state.error} onRetry={state.reload} compact />}
        {editors && (
          <div className="editors">
            {editors.map((editor) => (
              <Fragment key={editor.id}>
                <span className="mono-label">{editor.name}</span>
                <span className="mono editor-path">{editor.path ?? t('settings.editors.notFound')}</span>
                <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.pickEditor(editor.id))}>
                  {t('settings.editors.choose')}
                </button>
                {editor.custom ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.resetEditor(editor.id))}>
                    {t('settings.editors.reset')}
                  </button>
                ) : (
                  <span />
                )}
              </Fragment>
            ))}
          </div>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}

function UpdatesCard({ folder, onFolder }: { folder: string; onFolder: (folder: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const state = useAsync(() => api.update(), [folder], 60_000);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const u = state.data;
  const status = !u
    ? null
    : u.code
      ? errorMessage({ kind: 'internal', code: u.code, message: u.message ?? '' })
      : u.status === 'not-configured'
      ? t('settings.update.notConfigured')
      : u.available
        ? t('settings.update.available', { version: u.version ?? '' })
        : u.status === 'offline'
          ? t('settings.update.offline')
          : u.status === 'error'
            ? (u.message ?? '')
            : t('settings.update.latest');

  return (
    <section className="section">
      <div className="card form">
        <div className="field">
          <label className="mono-label" htmlFor="update-folder">{t('settings.updateFolder')}</label>
          <div className="row">
            <input id="update-folder" value={folder} placeholder={t('settings.updateFolder.none')} readOnly />
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => run(async () => {
                const next = (await api.pickUpdateFolder(t('settings.updateFolder.pick'))).updateFolder;
                if (next !== folder) onFolder(next);
              })}
            >
              {t('settings.updateFolder.browse')}
            </button>
            {folder && (
              <button className="btn btn-sm" disabled={busy} onClick={() => onFolder('')}>
                {t('settings.updateFolder.clear')}
              </button>
            )}
          </div>
          <span className="muted">{t('settings.updateFolder.hint')}</span>
        </div>
        {!u && !state.error && <Spinner small />}
        {state.error && <ErrorBanner error={state.error} onRetry={state.reload} compact />}
        {u && (
          <div className="field">
            <span>
              {t('settings.update.current', { version: u.current })} {status}
            </span>
            {u.source && <span className="muted">{t('settings.update.source', { source: sourceLabel(u.source) })}</span>}
            {u.available && u.notes && <pre className="mono muted">{u.notes}</pre>}
            {u.available && !u.canApply && <span className="muted">{t('settings.update.fromSource')}</span>}
            <div className="row">
              <button className="btn btn-sm" disabled={busy || !u.source} onClick={() => run(() => api.checkUpdate().then(() => state.reload()))}>
                {t('settings.update.check')}
              </button>
              {u.available && u.canApply && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy || restarting !== null}
                  onClick={() => run(async () => setRestarting((await api.applyUpdate()).version))}
                >
                  {t('settings.update.apply')}
                </button>
              )}
            </div>
          </div>
        )}
        {restarting && <span className="muted">{t('settings.update.restarting', { version: restarting })}</span>}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}

const sourceLabel = (id: string): string => (id.startsWith('github:') ? `GitHub ${id.slice(7)}` : `${t('settings.update.folder')} ${id.slice(7)}`);

const STORE_LABELS: Record<string, MessageKey> = {
  projects: 'settings.backup.store.projects',
  dbConnections: 'settings.backup.store.dbConnections',
  requests: 'settings.backup.store.requests',
};
const storeLabel = (name: string) => (Object.hasOwn(STORE_LABELS, name) ? t(STORE_LABELS[name]!) : name);

const toggled = (list: string[], name: string) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);

type Inspected = Extract<BackupInfo, { token: string }>;
type Imported = { settings: boolean; stores: Record<string, ImportResult> };

function BackupCard({ onSettings }: { onSettings: (settings: Settings) => void }) {
  const parts = useAsync(() => api.backupParts(), []);
  const [settings, setSettings] = useState(true);
  const [stores, setStores] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);

  const chosen = stores ?? parts.data?.stores ?? [];
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="card form">
        {!parts.data && !parts.error && <Spinner small />}
        {parts.error && <ErrorBanner error={parts.error} onRetry={parts.reload} compact />}
        {parts.data && (
          <div className="field">
            <span className="mono-label">{t('settings.backup.parts')}</span>
            <div className="chips">
              <button className={`chip${settings ? ' chip-on' : ''}`} onClick={() => setSettings(!settings)}>
                {t('settings.backup.settings')}
              </button>
              {parts.data.stores.map((name) => (
                <button key={name} className={`chip${chosen.includes(name) ? ' chip-on' : ''}`} onClick={() => setStores(toggled(chosen, name))}>
                  {storeLabel(name)}
                </button>
              ))}
            </div>
            <span className="muted">{t('settings.backup.hint')}</span>
            <div className="row">
              <button
                className="btn btn-sm"
                disabled={busy || (!settings && chosen.length === 0)}
                onClick={() => run(async () => setSaved((await api.exportBackup(settings, chosen)).path))}
              >
                {t('settings.backup.export')}
              </button>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => run(async () => {
                  const info = await api.inspectBackup();
                  if (info.token !== null) setInspected(info);
                })}
              >
                {t('settings.backup.import')}
              </button>
            </div>
            {saved && <span className="muted">{t('settings.backup.saved', { path: saved })}</span>}
          </div>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
      {inspected && <ImportDialog info={inspected} onSettings={onSettings} onClose={() => setInspected(null)} />}
    </section>
  );
}

function ImportDialog({ info, onSettings, onClose }: { info: Inspected; onSettings: (settings: Settings) => void; onClose: () => void }) {
  const [settings, setSettings] = useState(info.settings);
  const [stores, setStores] = useState(info.stores.filter((s) => s.known).map((s) => s.name));
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Imported | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await api.importBackup(info.token, settings, stores, mode);
      setResult(done);
      if (done.settings) onSettings(await api.settings());
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const footer = result ? (
    <button className="btn btn-primary" onClick={onClose}>{t('settings.backup.close')}</button>
  ) : (
    <>
      <button className="btn" onClick={onClose}>{t('dialog.cancel')}</button>
      <button className="btn btn-primary" disabled={busy || (!settings && stores.length === 0)} onClick={start}>
        {t('settings.backup.importNow')}
      </button>
    </>
  );
  const date = info.exportedAt ? new Date(info.exportedAt).toLocaleString() : '?';

  return (
    <Modal title={t('settings.backup.importTitle')} onClose={onClose} footer={footer}>
      <div className="form">
        <span className="muted">{t('settings.backup.from', { date, version: info.appVersion || '?' })}</span>
        {result ? (
          <ImportSummary result={result} />
        ) : (
          <>
            <div className="field">
              <span className="mono-label">{t('settings.backup.parts')}</span>
              <div className="chips">
                {info.settings && (
                  <button className={`chip${settings ? ' chip-on' : ''}`} onClick={() => setSettings(!settings)}>
                    {t('settings.backup.settings')}
                  </button>
                )}
                {info.stores.map((s) => (
                  <button
                    key={s.name}
                    className={`chip${stores.includes(s.name) ? ' chip-on' : ''}`}
                    disabled={!s.known}
                    title={s.known ? undefined : t('settings.backup.unknown')}
                    onClick={() => setStores(toggled(stores, s.name))}
                  >
                    {storeLabel(s.name)} ({s.count})
                  </button>
                ))}
              </div>
              {info.stores.some((s) => !s.known) && <span className="muted">{t('settings.backup.unknownHint')}</span>}
            </div>
            <div className="field">
              <span className="mono-label">{t('settings.backup.mode')}</span>
              <div className="chips">
                {(['merge', 'replace'] as const).map((m) => (
                  <button key={m} className={`chip${mode === m ? ' chip-on' : ''}`} onClick={() => setMode(m)}>
                    {t(m === 'merge' ? 'settings.backup.merge' : 'settings.backup.replace')}
                  </button>
                ))}
              </div>
              <span className="muted">{t(mode === 'merge' ? 'settings.backup.merge.hint' : 'settings.backup.replace.hint')}</span>
            </div>
          </>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </Modal>
  );
}

function ImportSummary({ result }: { result: Imported }) {
  return (
    <>
      {result.settings && <span>{t('settings.backup.settingsDone')}</span>}
      {Object.entries(result.stores).map(([name, r]) => (
        <div key={name} className="field">
          <span className="mono-label">{storeLabel(name)}</span>
          <span>{t('settings.backup.counts', { added: r.added, updated: r.updated, removed: r.removed })}</span>
          {r.skipped.map((s, i) => (
            <span key={i} className="tone-err small">
              {t('settings.backup.skipped', { id: s.id ?? '?', reason: errorMessage({ kind: 'invalid', code: s.code, message: s.message }) })}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
