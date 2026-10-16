import { lazy, Suspense, useEffect, useState } from 'react';
import type { SqlFormatOptions } from '@deckbuilderkit/editor/options';
import { type ApiError, deepEqual, ErrorBanner, SettingItem, type SettingsCardProps, type SettingsFieldProps, Spinner, useAsync } from '@deckbuilderkit/ui';
import type { WorkbenchClient, WorkbenchProject } from '../client';
import { t, type WorkbenchMessageKey } from '../i18n';
import { type WorkbenchViewSettings, withWorkbenchDefaults } from '../settings';

const CodeView = lazy(() => import('@deckbuilderkit/editor').then((m) => ({ default: m.CodeView })));

type Settings = WorkbenchViewSettings;

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase().replace(/\s+/g, ' ');

const FORMAT_GROUPS: ReadonlyArray<{ id: string; keys: ReadonlyArray<keyof SqlFormatOptions> }> = [
  { id: 'case', keys: ['keywordCase', 'functionCase'] },
  { id: 'select', keys: ['columnsPerLine', 'newlineAfterSelect', 'singleColumnInline'] },
  { id: 'conditions', keys: ['conditionPerLine', 'andOrPosition', 'joinConditionOnNewLine', 'spaceAroundOperators'] },
  { id: 'subqueries', keys: ['caseLayout', 'caseMaxWidth', 'subqueryNewlineAfterParen', 'subqueryCloseParenOnOwnLine'] },
  { id: 'statements', keys: ['indent', 'groupOrderListPerLine', 'fromTablesPerLine', 'setItemsPerLine', 'blankLineBetweenStatements'] },
];

/** Exercises every format option: comments, CASE, JOIN, several FROM tables, IN list, subqueries, GROUP/ORDER lists, UPDATE SET. */
const FORMAT_SAMPLE =
  "-- active staff per department\n" +
  "select e.id, e.name, lower(d.title) as dept, count(*) as n, case when e.salary>5000 then 'high' when e.salary>2000 then 'mid' else 'low' end as band /* salary band */ " +
  "from employees e join departments d on d.id=e.dept_id and d.active=1, locations l " +
  "where e.active=1 and l.id=d.location_id and (e.status in ('A', 'B', 'C') or e.manager_id is null) and d.region in (select region from regions where code='EU') " +
  "group by e.id, e.name, d.title, e.salary order by dept, e.name;\n" +
  "update employees set salary=salary*1.1, updated=sysdate, note='raise' where dept_id in (select id from departments where region='EU');";

/** Allowed projects as a short list with remove buttons, and a searchable "add" list for the rest. */
function ProjectsField({ projects, error, onRetry, value, onChange }: {
  projects: WorkbenchProject[] | undefined;
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

/** The allowed projects field with the project list loaded. */
export function projectsSettingField(client: WorkbenchClient) {
  return function ProjectsRow({ settings, onChange }: SettingsFieldProps<Settings>) {
    const projects = useAsync(() => client.projects(), []);
    const wb = withWorkbenchDefaults(settings.workbench);
    const save = (explorerProjects: string[]) => onChange({ workbench: { ...wb, explorerProjects } });
    return (
      <SettingItem id="workbench.explorerProjects" modified={!deepEqual(wb.explorerProjects, [])}>
        <ProjectsField projects={projects.data} error={projects.error} onRetry={projects.reload} value={wb.explorerProjects} onChange={save} />
      </SettingItem>
    );
  };
}

/** Which projects run SQL from the Explorer, and how many rows a run fetches. */
export function WorkbenchCard({ row }: SettingsCardProps<Settings>) {
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.workbench.sql')}</h4>
      <div className="card form">
        {row('workbench.explorerProjects')}
        {row('workbench.maxRows')}
        {row('workbench.confirmDestructive')}
        {row('workbench.queryTimeout')}
        {row('workbench.historySize')}
      </div>
    </section>
  );
}

/** How result cells read and copy. */
export function ResultsCard({ rows }: SettingsCardProps<Settings>) {
  return rows([
    'workbench.results.nullText',
    'workbench.results.dateFormat',
    'workbench.results.hideMidnight',
    'workbench.results.timestampFormat',
    'workbench.results.thousandsSeparator',
    'workbench.copyFormat',
  ]);
}

/** The SQL formatter options with a live preview. */
export function FormatterCard({ settings, row }: SettingsCardProps<Settings>) {
  const wb = withWorkbenchDefaults(settings.workbench);
  const [preview, setPreview] = useState(FORMAT_SAMPLE);
  useEffect(() => {
    let live = true;
    import('@deckbuilderkit/editor').then(({ formatSql }) => {
      let text = FORMAT_SAMPLE;
      try {
        text = formatSql(FORMAT_SAMPLE, wb.format);
      } catch { /* keep the raw sample */ }
      if (live) setPreview(text);
    });
    return () => { live = false; };
  }, [wb.format]);
  return (
    <div className="settings-format">
      <aside className="settings-format-preview">
        <h4 className="mono-label">{t('settings.workbench.preview')}</h4>
        <span className="muted">{t('settings.workbench.preview.hint')}</span>
        <Suspense fallback={null}><Suspense fallback={null}><CodeView value={preview} lang="sql" /></Suspense></Suspense>
      </aside>
      <div className="settings-format-options">
        {FORMAT_GROUPS.map((group) => (
          <section key={group.id} className="section">
            <h4 className="mono-label">{t(`settings.workbench.group.${group.id}` as WorkbenchMessageKey)}</h4>
            <div className="card form">
              {group.keys.map((key) => row(`workbench.format.${key}`))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
