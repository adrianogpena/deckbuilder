import { type ReactNode, useMemo, useRef, useState } from 'react';
import { type CodeEditorHandle, type CodeEditorProps, langOfFile, type RunMode } from '@deckbuilder/editor';
import { Badge, ErrorBanner, Icon, SplitView, type TabAction, useAsync, useCommand } from '@deckbuilder/ui';
import { api, type DbConnection, withWorkbenchDefaults, type WorkbenchSettings } from '../../api';
import { commandById } from '../../commands';
import { t } from '../../i18n';
import type { ScreenId } from '../../nav';
import { DEFAULT_RESULTS, SqlResults } from '../workbench/SqlResults';
import { useSqlRunner } from '../workbench/useSqlRunner';
import { useSqlSchema } from '../workbench/useSqlSchema';
import { useChordOf } from './tab-actions';

const DEFAULT_SPLIT: [number, number] = [0.6, 0.4];
const MANAGE = '::manage';

/** What the Explorer passes a file tab so `.sql` files of allowed projects can run SQL. */
export interface ExplorerSqlProps {
  /** The stored workbench settings: allowed projects, last connection per project, result format. */
  workbench?: Partial<WorkbenchSettings>;
  onWorkbenchChange(workbench: Partial<WorkbenchSettings>): void;
  /** Fractions of the editor and the results panel. */
  sizes?: [number, number];
  onSizesChange(sizes: [number, number]): void;
  go(screen: ScreenId): void;
}

interface Options {
  project: string;
  name: string;
  /** The text editor shows (not a preview). */
  active: boolean;
  focused: boolean;
  draft: string;
  sql?: ExplorerSqlProps;
}

/**
 * SQL of an Explorer file: connection dropdown and Run / Run all / Format tab actions, the editor's run keys and completions, and a results panel
 * below the editor. Only `.sql` files of projects in `workbench.explorerProjects`; the rest get nothing.
 * The connection's DB session is the Workbench's.
 */
export function useExplorerSql({ project, name, active, focused, draft, sql }: Options) {
  const settings = useMemo(() => withWorkbenchDefaults(sql?.workbench), [sql?.workbench]);
  const enabled = !!sql && active && langOfFile(name) === 'sql' && settings.explorerProjects.includes(project);
  const connections = useAsync(() => (enabled ? api.dbConnections() : Promise.resolve<DbConnection[]>([])), [enabled]);
  const connection = connections.data?.find((c) => c.id === settings.explorerConnections[project]);
  const db = enabled ? connection?.id : undefined;
  const runner = useSqlRunner(db, settings);
  const { sqlSchema } = useSqlSchema(db);
  const editor = useRef<CodeEditorHandle>(null);
  const [open, setOpen] = useState(false);
  const [resultSizes, setResultSizes] = useState<[number, number]>(DEFAULT_RESULTS);
  const chordOf = useChordOf();

  const run = (text: string, mode: RunMode) => {
    if (!db) return;
    setOpen(true);
    runner.run(text, mode);
  };
  const format = () => editor.current?.format(settings.format);
  useCommand(commandById('explorer.sql.format'), format, { enabled: focused && enabled });

  const changeConnection = (value: string) => {
    if (!sql) return;
    if (value === MANAGE) {
      sql.go('workbench');
      return;
    }
    runner.reset();
    const byProject = { ...settings.explorerConnections };
    if (value) byProject[project] = value;
    else delete byProject[project];
    sql.onWorkbenchChange({ ...sql.workbench, explorerConnections: byProject });
  };

  const noConnection = db ? undefined : t('explorer.sql.noConnection');
  const connectionOptions = [
    { value: '', label: t('explorer.sql.pickConnection') },
    ...(connections.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    { value: MANAGE, label: t('workbench.source.manage') },
  ];
  const actions: TabAction[] = enabled ? [
    { id: 'sql.connection', group: 'primary', label: t('workbench.source'), options: connectionOptions, value: connection?.id ?? '', run: (value) => changeConnection(value ?? '') },
    { id: 'sql.run', group: 'primary', icon: 'play', label: t('workbench.run'), hint: noConnection ?? 'Ctrl+Enter', disabled: !db || runner.busy, run: () => run(editor.current?.getRunText() ?? draft, 'statement') },
    { id: 'sql.runAll', group: 'primary', icon: 'forward', label: t('workbench.runAll'), hint: noConnection ?? 'Ctrl+Shift+Enter', disabled: !db || runner.busy, run: () => run(draft, 'all') },
    { id: 'sql.format', group: 'primary', icon: 'braces', label: t('workbench.format'), hint: chordOf('explorer.sql.format'), run: format },
  ] : [];

  const editorProps: Pick<CodeEditorProps, 'onRun' | 'sqlDialect' | 'sqlSchema'> = enabled ? { onRun: run, sqlDialect: 'plsql', sqlSchema } : {};

  const { status, starting } = runner;
  /** `editorNode` alone, or for SQL files with the results panel below. */
  const layout = (editorNode: ReactNode): ReactNode => {
    if (!enabled || !sql) return editorNode;
    const sizes = open ? (sql.sizes ?? DEFAULT_SPLIT) : [1];
    return (
      <SplitView
        direction="column"
        sizes={sizes}
        defaultSizes={open ? DEFAULT_SPLIT : undefined}
        onResize={(s) => s.length === 2 && sql.onSizesChange([s[0], s[1]])}
      >
        <div key="editor" className="wb-pane">
          <div className="xp-sql-editor">{editorNode}</div>
        </div>
        {open && (
          <div key="results" className="wb-pane">
            <div className="xp-bar">
              <Icon name="database" size={12} />
              <span>{connection?.name}</span>
              {status?.pending && <Badge tone="warn">{t('workbench.tx.pending')}</Badge>}
              <span className="spacer" />
              {runner.running && <button className="btn btn-sm" onClick={runner.cancel}>{t('workbench.cancel')}</button>}
              <button className="btn btn-sm" onClick={runner.copy} disabled={runner.tableRows.length === 0}>{t(runner.selection.length > 0 ? 'workbench.copySelected' : 'workbench.copy')}</button>
              <button className="btn btn-sm" onClick={runner.commit} disabled={!status?.connected || starting}>{t('workbench.tx.commit')}</button>
              <button className="btn btn-sm" onClick={runner.rollback} disabled={!status?.connected || starting}>{t('workbench.tx.rollback')}</button>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setOpen(false)} title={t('explorer.sql.close')} aria-label={t('explorer.sql.close')}>
                <Icon name="close" />
              </button>
            </div>
            {runner.actionError && <ErrorBanner error={runner.actionError} compact />}
            <SqlResults runner={runner} sizes={resultSizes} onSizes={setResultSizes} />
          </div>
        )}
      </SplitView>
    );
  };

  return { enabled, editor, editorProps, actions, layout };
}
