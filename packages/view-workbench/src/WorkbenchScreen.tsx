import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor, type CodeEditorHandle, type SqlProblem, SqlSteps, type SqlStepsTab } from '@deckbuilderkit/editor';
import {
  type ApiError,
  Badge,
  ContextMenu,
  errorMessage,
  errorOf,
  ErrorBanner,
  Icon,
  PageHead,
  SplitView,
  useAsync,
  useCommand,
  useShortcutTip,
  useDebouncedSave,
  useDialogs,
  useToast,
} from '@deckbuilderkit/ui';
import { EXPORT_ROWS, type ExportFormat, exportResults, DEFAULT_RESULTS, SqlResults, useSqlRunner, useSqlSchema, useTableDetails } from '@deckbuilderkit/sql-ui';
import type { DbSchemaTable } from '@deckbuilderkit/sql-ui';
import type { WorkbenchClient } from './client';
import { t } from './i18n';
import { sqlRunnerSettings, type WorkbenchSettings, type WorkbenchViewSettings, withWorkbenchDefaults } from './settings';
import { workbenchCommands } from './commands';
import { Connections } from './workbench/Connections';
import { HistoryPanel } from './workbench/HistoryPanel';
import { SchemaPanel } from './workbench/SchemaPanel';

const SAVE_DELAY = 500;
const DEMO_SOURCE = 'demo';
const MANAGE = '::manage';
const DEFAULT_MAIN: [number, number] = [0.3, 0.7];

const commandById = (id: string) => workbenchCommands().find((c) => c.id === id)!;

export function WorkbenchScreen({ settings, onSave, client }: { settings: WorkbenchViewSettings; onSave: (patch: Partial<WorkbenchViewSettings>) => void; client: WorkbenchClient }) {
  const [state, setState] = useState<WorkbenchSettings>(() => withWorkbenchDefaults(settings.workbench));
  const [query, setQuery] = useState('');
  const [docError, setDocError] = useState<ApiError>();
  const [managing, setManaging] = useState(false);
  const connections = useAsync(() => client.connections(), []);
  const { confirm, element: dialogs } = useDialogs();
  const editor = useRef<CodeEditorHandle>(null);
  const [cursor, setCursor] = useState(0);

  const persist = useDebouncedSave((next: WorkbenchSettings) => onSave({ workbench: next }));
  const latest = useRef(state);
  const update = (patch: (s: WorkbenchSettings) => Partial<WorkbenchSettings>) => {
    const next = { ...latest.current, ...patch(latest.current) };
    latest.current = next;
    setState(next);
    persist(next);
  };

  const connection = state.source && state.source !== DEMO_SOURCE ? connections.data?.find((c) => c.id === state.source) : undefined;
  const db = connection?.id;
  const doc = state.doc ?? { kind: 'default' as const };
  const runner = useSqlRunner(client, db, sqlRunnerSettings(state), confirm);
  const docKey = doc.kind === 'file' ? `file:${doc.project}:${doc.path}` : db ? `db:${db}` : '';
  const docName = doc.kind === 'file' ? (doc.path.split(/[\\/]/).pop() ?? doc.path) : '';

  // The edited document: loaded when `docKey` changes, saved after a pause; a pending save is flushed before the switch.
  const docWrite = useRef<((text: string) => Promise<void>) | undefined>();
  const pendingText = useRef<string>();
  const lastText = useRef('');
  const loaded = useRef(false);
  const saveTimer = useRef<number>();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const flushDoc = () => {
    window.clearTimeout(saveTimer.current);
    const text = pendingText.current;
    pendingText.current = undefined;
    const write = docWrite.current;
    if (text !== undefined && write) queue.current = queue.current.then(() => write(text));
  };
  const edit = (text: string) => {
    setQuery(text);
    if (!loaded.current || !docWrite.current || text === lastText.current) return;
    lastText.current = text;
    pendingText.current = text;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushDoc, SAVE_DELAY);
  };
  useEffect(() => {
    let live = true;
    loaded.current = false;
    docWrite.current = undefined;
    lastText.current = '';
    setQuery('');
    setDocError(undefined);
    const ready = (text: string, write: (text: string) => Promise<void>) => {
      if (!live) return;
      lastText.current = text;
      docWrite.current = write;
      loaded.current = true;
      setQuery(text);
    };
    const failed = (err: unknown) => {
      if (live) setDocError(errorOf(err));
    };
    if (doc.kind === 'file') {
      const { project, path } = doc;
      client.readFile(project, path).then((read) => {
        if (typeof read.text !== 'string' || read.truncated) throw new Error(t('workbench.doc.notText', { name: docName }));
        let mtime = read.mtime;
        const crlf = read.text.includes('\r\n');
        let stopped = false;
        ready(read.text.replace(/\r\n/g, '\n'), async (text) => {
          if (stopped) return;
          try {
            mtime = (await client.writeFile(project, path, crlf ? text.replace(/\n/g, '\r\n') : text, mtime, read.encoding)).mtime;
          } catch (err) {
            if (errorOf(err).code === 'fileChanged') stopped = true;
            failed(err);
          }
        });
      }, failed);
    } else if (db) {
      client.script(db).then((text) => ready(text, (next) => client.saveScript(db, next).then(() => undefined, failed)), failed);
    }
    return () => {
      live = false;
      flushDoc();
      docWrite.current = undefined;
    };
    // Deps are deliberately partial.
  }, [docKey]);

  const schemaOpen = !!db && !!state.schema;
  // Loaded (which connects) as soon as a database is chosen, panel open or not: the editor completes from it.
  const { schema, loading: schemaLoading, error: schemaError, setOwner, reload: reloadSchema, sqlSchema } = useSqlSchema(client, db);

  // The panel shows its own state; closed, the log tells why completions are missing.
  useEffect(() => {
    if (!schemaLoading) runner.refreshStatus();
    if (schemaError && !schemaOpen) runner.log(t('workbench.log.schemaFailed', { message: errorMessage(schemaError) }), 'err');
    // Deps are deliberately partial.
  }, [schemaLoading, schemaError]);

  const run = () => runner.run(editor.current?.getRunText() ?? query, 'statement');
  const runAll = () => runner.run(query, 'all');
  const format = () => editor.current?.format(withWorkbenchDefaults(settings.workbench).format);
  const tip = useShortcutTip();
  useCommand(commandById('workbench.format'), format);
  const explain = () => void runner.explain(editor.current?.getRunText() ?? query);
  useCommand(commandById('workbench.explain'), explain);
  const [stepsTab, setStepsTab] = useState<SqlStepsTab>('steps');
  const [lintErrors, setLintErrors] = useState(0);
  const onSqlProblems = useCallback((problems: SqlProblem[]) => setLintErrors(problems.filter((p) => p.severity === 'error').length), []);
  const showProblems = () => {
    setStepsTab('problems');
    if (!latest.current.steps) update(() => ({ steps: true }));
  };
  useCommand(commandById('workbench.problems'), showProblems);

  const { cols, tableRows, selection, log, setActionError, shown, status } = runner;
  const exportCols = () => cols.map((c) => ({ label: c.label, value: c.value }));

  const toast = useToast();
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number }>();
  const exportAs = async (format: ExportFormat) => {
    setActionError(undefined);
    try {
      const message = await exportResults(client, format, exportCols(), tableRows, runner.truncated);
      if (!message) return;
      log(message, 'ok');
      toast({ message });
    } catch (err) {
      setActionError(errorOf(err));
    }
  };
  const openExportMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setExportMenu({ x: r.left, y: r.bottom });
  };

  const disconnect = async () => {
    if (status?.pending && !(await confirm({ title: t('workbench.tx.disconnect'), body: t('workbench.tx.disconnectConfirm'), okLabel: t('workbench.tx.disconnect'), danger: true }))) return;
    await runner.disconnect();
  };

  const pickTable = (table: DbSchemaTable, tableOwner: string) => {
    const quote = (name: string) => (/^[A-Z][A-Z0-9_$#]*$/.test(name) ? name : `"${name}"`);
    edit(`select * from ${quote(tableOwner)}.${quote(table.name)}`);
  };

  const tableDetails = useTableDetails(client, db);
  // The Workbench has one editor: the DDL replaces its text, after a confirm when it holds a query.
  const showDdl = async (table: DbSchemaTable, tableOwner: string) => {
    const data = await tableDetails.load(tableOwner, table.name);
    if (!data?.ddl) {
      toast({ message: t('workbench.schema.noDdl', { name: table.name }) });
      return;
    }
    if (query.trim() && !(await confirm({ title: t('workbench.schema.showDdl'), body: t('workbench.schema.ddlConfirm', { name: table.name }), okLabel: t('workbench.schema.ddlReplace') }))) return;
    edit(data.ddl);
  };

  const changeSource = (value: string) => {
    if (value === MANAGE) {
      setManaging(true);
      return;
    }
    runner.reset();
    setOwner(undefined);
    update(() => ({ source: value }));
  };

  const sizes = state.sizes ?? { main: DEFAULT_MAIN, results: DEFAULT_RESULTS };
  const demoWidths = shown.kind !== 'db';
  const { busy, starting } = runner;

  // Reloads the history panel each time a run finishes.
  const [runsDone, setRunsDone] = useState(0);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) setRunsDone((n) => n + 1);
    wasBusy.current = busy;
  }, [busy]);

  const insertSql = (sql: string) => {
    const view = editor.current?.view;
    if (!view) return edit(query ? `${query}
${sql}` : sql);
    const sel = view.state.selection.main;
    editor.current?.replaceRange(sel.from, sel.to, sql);
    editor.current?.focus();
  };
  const connectionName = (id: string) => connections.data?.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="content">
      {dialogs}
      <PageHead title={t('nav.workbench')}>
      <div className="row wb-bar">
          <select value={connection ? connection.id : DEMO_SOURCE} onChange={(e) => changeSource(e.target.value)} aria-label={t('workbench.source')} title={t('workbench.source')}>
            <option value={DEMO_SOURCE}>{t('workbench.source.demo')}</option>
            {connections.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value={MANAGE}>{t('workbench.source.manage')}</option>
          </select>
          <button className="btn btn-sm" onClick={() => setManaging(true)} title={t('workbench.source.manage')} aria-label={t('workbench.source.manage')}>
            <Icon name="database" /> {t('workbench.conn.button')}
          </button>
          <button className="btn btn-primary btn-sm" data-run onClick={run} disabled={busy} title={t('workbench.run')}>
            <Icon name="play" /> {t('workbench.run')}
          </button>
          <button className="btn btn-sm" onClick={runAll} disabled={busy} title={t('workbench.runAll.title')}>
            <Icon name="play" /> {t('workbench.runAll')}
          </button>
          <button className="btn btn-sm" onClick={explain} disabled={!db || busy || runner.explaining} title={tip(t('workbench.explain.title'), 'workbench.explain')}>
            <Icon name="plan" /> {t('workbench.explain')}
          </button>
          <button className="btn btn-sm" onClick={format} title={tip(t('workbench.format'), 'workbench.format')}>{t('workbench.format')}</button>
          {runner.running && <button className="btn btn-sm" onClick={runner.cancel} title={t('workbench.cancel')}>{t('workbench.cancel')}</button>}
          {db && (
            <>
              <button className="btn btn-sm" onClick={() => update((cur) => ({ schema: !cur.schema }))} aria-pressed={!!state.schema} title={t('workbench.schema')}>
                <Icon name="table" /> {t('workbench.schema')}
              </button>
              {status?.pending && <Badge tone="warn">{t('workbench.tx.pending')}</Badge>}
              <button className="btn btn-sm" onClick={runner.commit} disabled={!status?.connected || starting} title={t('workbench.tx.commit')}>{t('workbench.tx.commit')}</button>
              <button className="btn btn-sm" onClick={runner.rollback} disabled={!status?.connected || starting} title={t('workbench.tx.rollback')}>{t('workbench.tx.rollback')}</button>
              <button className="btn btn-sm" onClick={disconnect} disabled={!status?.connected || starting} title={t('workbench.tx.disconnect')}>{t('workbench.tx.disconnect')}</button>
            </>
          )}
          <button className="btn btn-sm" onClick={() => update((cur) => ({ steps: !cur.steps }))} aria-pressed={!!state.steps} title={t('workbench.steps.title')}>
            <Icon name="list-flat" /> {t('workbench.steps')}
            {!state.steps && lintErrors > 0 && (
              <span className="sqlsteps-count is-error wb-steps-badge" title={t('workbench.steps.errors', { count: lintErrors })}>{lintErrors}</span>
            )}
          </button>
          <button className="btn btn-sm" onClick={() => update((cur) => ({ history: !cur.history }))} aria-pressed={!!state.history} title={t('workbench.history')}>
            <Icon name="history" /> {t('workbench.history')}
          </button>
          <button className="btn btn-sm" onClick={openExportMenu} disabled={tableRows.length === 0} aria-haspopup="menu" aria-expanded={!!exportMenu} title={t('workbench.export')}>{t('workbench.export')}</button>
          {exportMenu && (
            <ContextMenu
              at={exportMenu}
              onClose={() => setExportMenu(undefined)}
              items={[
                { id: 'csv', label: t('workbench.export.csv'), run: () => void exportAs('csv') },
                { id: 'json', label: t('workbench.export.json'), run: () => void exportAs('json') },
              ]}
            />
          )}
          <button className="btn btn-sm" onClick={runner.copy} disabled={tableRows.length === 0} title={t(selection.length > 0 ? 'workbench.copySelected' : 'workbench.copy')}>{t(selection.length > 0 ? 'workbench.copySelected' : 'workbench.copy')}</button>
          {doc.kind === 'file' && (
            <>
              <span className="muted" title={doc.path}>{t('workbench.doc.file', { name: docName })}</span>
              <button className="btn btn-sm" onClick={() => update(() => ({ doc: { kind: 'default' } }))} title={t('workbench.doc.default')}>{t('workbench.doc.default')}</button>
            </>
          )}
          <span className="muted">{t('workbench.exportHint', { count: EXPORT_ROWS })}</span>
      </div>
      </PageHead>
      {runner.actionError && <ErrorBanner error={runner.actionError} compact />}
      {docError && <ErrorBanner error={docError} compact />}
      <div className="wb-body">
      {schemaOpen && (
        <SchemaPanel
          schema={schema}
          loading={schemaLoading}
          error={schemaError}
          onOwner={setOwner}
          onReload={reloadSchema}
          onPick={pickTable}
          details={tableDetails}
          onDdl={(table, tableOwner) => void showDdl(table, tableOwner)}
        />
      )}
      <SplitView
        direction="column"
        sizes={[sizes.main[0], sizes.main[1]]}
        defaultSizes={DEFAULT_MAIN}
        onResize={(s) => update((cur) => ({ sizes: { ...(cur.sizes ?? sizes), main: [s[0], s[1]] } }))}
      >
        <div key="editor" className="wb-pane">
          <CodeEditor ref={editor} value={query} lang="sql" sqlDialect="plsql" sqlSchema={sqlSchema} onChange={edit} onRun={runner.run} onSelection={(s) => setCursor(s.pos)} height="100%" sqlLint onSqlProblems={onSqlProblems} />
        </div>
        <div key="results" className="wb-pane">
          <SqlResults
            runner={runner}
            sizes={sizes.results}
            onSizes={(results) => update((cur) => ({ sizes: { ...(cur.sizes ?? sizes), results } }))}
            widths={demoWidths ? state.widths : undefined}
            onWidths={demoWidths ? (widths) => update(() => ({ widths })) : undefined}
          />
        </div>
      </SplitView>
      {state.steps && (
        <SqlSteps
          text={query}
          cursor={cursor}
          onJump={(from, to) => editor.current?.reveal(from, to)}
          onClose={() => update(() => ({ steps: false }))}
          tab={stepsTab}
          onTab={setStepsTab}
          width={state.stepsWidth}
          onWidth={(stepsWidth) => update(() => ({ stepsWidth }))}
        />
      )}
      {state.history && (
        <HistoryPanel client={client} connection={db} refresh={runsDone} connectionName={connectionName} onInsert={insertSql} onOpen={edit} confirm={confirm} />
      )}
      </div>
      {managing && <Connections client={client} onClose={() => setManaging(false)} onChanged={connections.reload} />}
    </div>
  );
}
