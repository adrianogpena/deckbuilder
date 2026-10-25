import { lazy, Suspense, useEffect, useState } from 'react';
import type { SqlFormatOptions } from '@kedalion/editor/options';
import type { SettingsCardProps } from '@kedalion/ui';
import { t, type WorkbenchMessageKey } from '../i18n';
import { type WorkbenchViewSettings, withWorkbenchDefaults } from '../settings';

const CodeView = lazy(() => import('@kedalion/editor').then((m) => ({ default: m.CodeView })));

type Settings = WorkbenchViewSettings;

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

/** How many rows a run fetches, and the run safeguards. */
export function WorkbenchCard({ row }: SettingsCardProps<Settings>) {
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.workbench.sql')}</h4>
      <div className="card form">
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
    import('@kedalion/editor').then(({ formatSql }) => {
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
