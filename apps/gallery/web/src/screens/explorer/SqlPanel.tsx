import { type ReactNode, useMemo, useRef, useState } from 'react';
import { type CodeEditorHandle, type CodeEditorProps, langOfFile, resolveMarkers, type RunMode, sqlMarkers, sqlParams, type SqlParam } from '@deckbuilder/editor';
import { Badge, ErrorBanner, Icon, Modal, SplitView, type TabAction, useAsync, useCommand } from '@deckbuilder/ui';
import { api, type DbConnection, withWorkbenchDefaults, type WorkbenchSettings } from '../../api';
import { commandById } from '../../commands';
import { t } from '../../i18n';
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
  go(screen: string): void;
  /** Active REST environment id ('' = none); `.curl` runs substitute its variables. */
  restEnvironment?: string;
}

interface Options {
  project: string;
  name: string;
  /** Treat the file as SQL whatever its extension (SQL view of a query XML). */
  asSql?: boolean;
  /** The text editor shows (not a preview). */
  active: boolean;
  focused: boolean;
  draft: string;
  sql?: ExplorerSqlProps;
  confirm: (opts: { title: string; body?: string; okLabel?: string; danger?: boolean }) => Promise<boolean>;
  /** Called when a run opens the results, so another bottom panel can give way. */
  onRunStart?: () => void;
}

function ParamsDialog({ params, initial, onSubmit, onClose }: { params: SqlParam[]; initial: Record<number, string>; onSubmit: (values: Record<number, string>) => void; onClose: () => void }) {
  const [values, setValues] = useState<Record<number, string>>(initial);
  const submit = () => onSubmit(values);
  return (
    <Modal
      title={t('explorer.sql.params')}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose}>{t('workbench.cancel')}</button>
          <button className="btn btn-primary" onClick={submit}>{t('explorer.sql.paramsRun')}</button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: 'grid', gap: 10 }}>
        <p className="muted">{t('explorer.sql.paramsHint')}</p>
        {params.map((p, i) => (
          <label key={p.n} style={{ display: 'grid', gap: 4 }}>
            <span><code>{`{${p.n}}`}</code> <span className="muted">{t(p.unguarded === 0 ? 'explorer.sql.paramOptional' : 'explorer.sql.paramRequired')}</span></span>
            <input className="input" autoFocus={i === 0} onFocus={i === 0 ? (e) => e.target.select() : undefined} value={values[p.n] ?? ''} onChange={(e) => setValues({ ...values, [p.n]: e.target.value })} />
          </label>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/**
 * SQL of an Explorer file: connection dropdown and Run / Run all / Format tab actions, the editor's run keys and completions, and a results panel
 * below the editor. Only `.sql` files of projects in `workbench.explorerProjects`; the rest get nothing.
 * The connection's DB session is the Workbench's.
 */
export function useExplorerSql({ project, name, asSql, active, focused, draft, sql, confirm, onRunStart }: Options) {
  const settings = useMemo(() => withWorkbenchDefaults(sql?.workbench), [sql?.workbench]);
  const enabled = !!sql && active && (asSql || langOfFile(name) === 'sql') && settings.explorerProjects.includes(project);
  const connections = useAsync(() => (enabled ? api.dbConnections() : Promise.resolve<DbConnection[]>([])), [enabled]);
  const connection = connections.data?.find((c) => c.id === settings.explorerConnections[project]);
  const db = enabled ? connection?.id : undefined;
  const runner = useSqlRunner(db, settings, confirm);
  const { sqlSchema } = useSqlSchema(db);
  const editor = useRef<CodeEditorHandle>(null);
  const [open, setOpen] = useState(false);
  const [resultSizes, setResultSizes] = useState<[number, number]>(DEFAULT_RESULTS);
  const chordOf = useChordOf();

  const fileKey = `${project}/${name}`;
  const [remembered, setRemembered] = useState<Record<string, Record<number, string>>>({});
  const [dialog, setDialog] = useState<{ text: string; mode: RunMode } | 'edit' | null>(null);
  const [paramError, setParamError] = useState<string>();

  const execute = (text: string, mode: RunMode, values: Record<number, string>) => {
    if (!db) return;
    let sqlText = text;
    if (sqlParams(text).length > 0 || sqlMarkers(text).length > 0) {
      const r = resolveMarkers(text, values);
      if (r.error) {
        setParamError(r.error);
        setOpen(true);
        return;
      }
      sqlText = r.sql;
    }
    setParamError(undefined);
    setOpen(true);
    onRunStart?.();
    runner.run(sqlText, mode);
  };
  const run = (text: string, mode: RunMode) => {
    if (!db) return;
    if (sqlParams(text).length > 0) {
      setDialog({ text, mode });
      return;
    }
    execute(text, mode, remembered[fileKey] ?? {});
  };
  const editParams = () => setDialog('edit');
  const submitParams = (values: Record<number, string>) => {
    const pending = dialog;
    setRemembered((r) => ({ ...r, [fileKey]: values }));
    setDialog(null);
    if (pending && pending !== 'edit') execute(pending.text, pending.mode, values);
  };
  const format = () => editor.current?.format(settings.format);
  useCommand(commandById('explorer.sql.format'), format, { enabled: focused && enabled && !asSql });

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
    ...(sqlParams(draft).length > 0 ? [{ id: 'sql.params', group: 'primary' as const, icon: 'code' as const, label: t('explorer.sql.params'), run: editParams }] : []),
    ...(asSql ? [] : [{ id: 'sql.format', group: 'primary' as const, icon: 'braces' as const, label: t('workbench.format'), hint: chordOf('explorer.sql.format'), run: format }]),
  ] : [];

  const editorProps: Pick<CodeEditorProps, 'onRun' | 'sqlDialect' | 'sqlSchema'> = enabled ? { onRun: run, sqlDialect: 'plsql', sqlSchema } : {};

  const { status, starting } = runner;
  /** `editorNode` alone, or with a bottom panel: `steps` when given, else the results of a SQL file. They compete for the same slot. */
  const layout = (editorNode: ReactNode, steps?: ReactNode): ReactNode => (
    <>
      {baseLayout(editorNode, steps)}
      {dialog && (
        <ParamsDialog
          params={sqlParams(dialog === 'edit' ? draft : dialog.text)}
          initial={remembered[fileKey] ?? {}}
          onSubmit={submitParams}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
  const baseLayout = (editorNode: ReactNode, steps?: ReactNode): ReactNode => {
    const showResults = enabled && !!sql && open && !steps;
    if (!steps && !(enabled && sql)) return editorNode;
    const bottom = !!steps || showResults;
    const sizes = bottom ? (sql?.sizes ?? DEFAULT_SPLIT) : [1];
    return (
      <SplitView
        direction="column"
        sizes={sizes}
        defaultSizes={bottom ? DEFAULT_SPLIT : undefined}
        onResize={(s) => s.length === 2 && sql?.onSizesChange([s[0], s[1]])}
      >
        <div key="editor" className="wb-pane">
          <div className="xp-sql-editor">{editorNode}</div>
        </div>
        {steps && <div key="steps" className="wb-pane">{steps}</div>}
        {showResults && (
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
            {paramError && <ErrorBanner error={{ kind: 'client', code: 'raw', message: paramError }} compact />}
            {runner.actionError && <ErrorBanner error={runner.actionError} compact />}
            <SqlResults runner={runner} sizes={resultSizes} onSizes={setResultSizes} />
          </div>
        )}
      </SplitView>
    );
  };

  const closeResults = () => setOpen(false);

  const paramValues = remembered[fileKey] ?? {};
  const setParamValue = (n: number, value: string) => setRemembered((r) => ({ ...r, [fileKey]: { ...r[fileKey], [n]: value } }));

  return { enabled, editor, editorProps, actions, layout, closeResults, paramValues, setParamValue };
}
