import { type ReactNode, useMemo, useRef, useState } from 'react';
import { type CodeEditorHandle, type CodeEditorProps, langOfFile, resolveMarkers, type RunMode, sqlMarkers, sqlParams, type SqlParam } from '@kedalion/editor';
import { Badge, Button, ErrorBanner, Icon, IconButton, Modal, SplitView, type TabAction, useAsync, useCommand, useViewLink } from '@kedalion/ui';
import { DEFAULT_RESULTS, SqlResults, useSqlRunner, useSqlSchema } from '@kedalion/sql-ui';
import { type ExplorerWorkbench, sqlRunnerSettings, withWorkbenchDefaults } from '../settings';
import { explorerCommandById as commandById } from '../commands';
import { t } from '../i18n';
import { sqlClient } from '../client';
import { useChordOf } from './tab-actions';

const DEFAULT_SPLIT: [number, number] = [0.6, 0.4];
const MANAGE = '::manage';

/** What the Explorer passes a file tab so `.sql` files of allowed projects can run SQL. */
export interface ExplorerSqlProps {
  /** The stored workbench settings: allowed projects, last connection per project, result format. */
  workbench?: Partial<ExplorerWorkbench>;
  onWorkbenchChange(workbench: Partial<ExplorerWorkbench>): void;
  /** Last connection id per project id. */
  connections?: Record<string, string>;
  onConnectionsChange(connections: Record<string, string>): void;
  /** Fractions of the editor and the results panel. */
  sizes?: [number, number];
  onSizesChange(sizes: [number, number]): void;
  /** Active REST environment id ('' = none); `.curl` runs substitute its variables. */
  restEnvironment?: string;
}

interface Options {
  project: string;
  name: string;
  /** Project-relative path; keys remembered parameter values (falls back to `name`). */
  path?: string;
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
          <Button onClick={onClose} title={t('explorer.shared.cancel')}>{t('explorer.shared.cancel')}</Button>
          <Button variant="primary" icon="play" onClick={submit} title={t('explorer.sql.paramsRun')}>{t('explorer.sql.paramsRun')}</Button>
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
 * below the editor. Only `.sql` files; the rest get nothing.
 * The connection's DB session is the Workbench's.
 */
export function useExplorerSql({ project, name, path, asSql, active, focused, draft, sql, confirm, onRunStart }: Options) {
  const settings = useMemo(() => withWorkbenchDefaults(sql?.workbench), [sql?.workbench]);
  const enabled = !!sql && active && (asSql || langOfFile(name) === 'sql');
  const connections = useAsync(() => (enabled ? sqlClient.connections() : Promise.resolve([])), [enabled]);
  const connection = connections.data?.find((c) => c.id === sql?.connections?.[project]);
  const db = enabled ? connection?.id : undefined;
  const runner = useSqlRunner(sqlClient, db, sqlRunnerSettings(settings), confirm);
  const { sqlSchema } = useSqlSchema(sqlClient, db);
  const editor = useRef<CodeEditorHandle>(null);
  const [open, setOpen] = useState(false);
  const [resultSizes, setResultSizes] = useState<[number, number]>(DEFAULT_RESULTS);
  const chordOf = useChordOf();

  const fileKey = `${project}/${path ?? name}`;
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

  const toWorkbench = useViewLink('workbench');
  const changeConnection = (value: string) => {
    if (!sql) return;
    if (value === MANAGE) {
      toWorkbench?.();
      return;
    }
    runner.reset();
    const byProject = { ...sql.connections };
    if (value) byProject[project] = value;
    else delete byProject[project];
    sql.onConnectionsChange(byProject);
  };

  const noConnection = db ? undefined : t('explorer.sql.noConnection');
  const connectionOptions = [
    { value: '', label: t('explorer.sql.pickConnection') },
    ...(connections.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    ...(toWorkbench ? [{ value: MANAGE, label: t('explorer.shared.sourceManage') }] : []),
  ];
  const actions: TabAction[] = enabled ? [
    { id: 'sql.connection', group: 'primary', label: t('explorer.shared.source'), options: connectionOptions, value: connection?.id ?? '', run: (value) => changeConnection(value ?? '') },
    { id: 'sql.run', group: 'primary', icon: 'play', label: t('explorer.shared.run'), hint: noConnection ?? 'Ctrl+Enter', disabled: !db || runner.busy, run: () => run(editor.current?.getRunText() ?? draft, 'statement') },
    { id: 'sql.runAll', group: 'primary', icon: 'forward', label: t('explorer.shared.runAll'), hint: noConnection ?? 'Ctrl+Shift+Enter', disabled: !db || runner.busy, run: () => run(draft, 'all') },
    ...(sqlParams(draft).length > 0 ? [{ id: 'sql.params', group: 'primary' as const, icon: 'code' as const, label: t('explorer.sql.params'), run: editParams }] : []),
    ...(asSql ? [] : [{ id: 'sql.format', group: 'primary' as const, icon: 'braces' as const, label: t('explorer.shared.format'), hint: chordOf('explorer.sql.format'), run: format }]),
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
        <div key="editor" className="ex-pane">
          <div className="xp-sql-editor">{editorNode}</div>
        </div>
        {steps && <div key="steps" className="ex-pane">{steps}</div>}
        {showResults && (
          <div key="results" className="ex-pane">
            <div className="xp-bar">
              <Icon name="database" size={12} />
              <span>{connection?.name}</span>
              {status?.pending && <Badge tone="warn">{t('explorer.shared.txPending')}</Badge>}
              <span className="spacer" />
              {runner.running && <Button size="sm" variant="danger" icon="square" onClick={runner.cancel} title={t('explorer.shared.cancel')}>{t('explorer.shared.cancel')}</Button>}
              <Button size="sm" variant="ghost" icon="copy" onClick={runner.copy} disabled={runner.tableRows.length === 0} title={t(runner.selection.length > 0 ? 'explorer.shared.copySelected' : 'explorer.shared.copy')}>{t(runner.selection.length > 0 ? 'explorer.shared.copySelected' : 'explorer.shared.copy')}</Button>
              <Button size="sm" icon="check" onClick={runner.commit} disabled={!status?.connected || starting} title={t('explorer.shared.txCommit')}>{t('explorer.shared.txCommit')}</Button>
              <Button size="sm" icon="rotate-ccw" onClick={runner.rollback} disabled={!status?.connected || starting} title={t('explorer.shared.txRollback')}>{t('explorer.shared.txRollback')}</Button>
              <IconButton icon="close" onClick={() => setOpen(false)} label={t('explorer.sql.close')} />
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
