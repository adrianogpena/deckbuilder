import { useEffect, useRef, useState } from 'react';
import { CodeEditor, type CodeEditorHandle } from '@deckbuilder/editor';
import {
  type ApiError,
  Badge,
  errorMessage,
  errorOf,
  ErrorBanner,
  Icon,
  PageHead,
  SplitView,
  toCsv,
  useAsync,
  useCommand,
  useDebouncedSave,
  useDialogs,
} from '@deckbuilder/ui';
import { api, withWorkbenchDefaults, type DbSchemaTable, type Settings, type WorkbenchSettings } from '../api';
import { commandById } from '../commands';
import { t } from '../i18n';
import { Connections } from './workbench/Connections';
import { SchemaPanel } from './workbench/SchemaPanel';
import { DEFAULT_RESULTS, SqlResults } from './workbench/SqlResults';
import { useSqlRunner } from './workbench/useSqlRunner';
import { useSqlSchema } from './workbench/useSqlSchema';

const SAVE_DELAY = 500;
const DEMO_SOURCE = 'demo';
const MANAGE = '::manage';
const EXPORT_ROWS = 10_000;
const DEFAULT_MAIN: [number, number] = [0.3, 0.7];

export function WorkbenchScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [state, setState] = useState<WorkbenchSettings>(() => withWorkbenchDefaults(settings.workbench));
  const [query, setQuery] = useState('');
  const [docError, setDocError] = useState<ApiError>();
  const [managing, setManaging] = useState(false);
  const connections = useAsync(() => api.dbConnections(), []);
  const { confirm, element: dialogs } = useDialogs();
  const editor = useRef<CodeEditorHandle>(null);

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
  const runner = useSqlRunner(db, state, confirm);
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
      api.fsRead(project, path).then((read) => {
        if (!('text' in read) || read.truncated) throw new Error(t('workbench.doc.notText', { name: docName }));
        let mtime = read.mtime;
        const crlf = read.text.includes('\r\n');
        let stopped = false;
        ready(read.text.replace(/\r\n/g, '\n'), async (text) => {
          if (stopped) return;
          try {
            mtime = (await api.fsWrite(project, path, crlf ? text.replace(/\n/g, '\r\n') : text, mtime, read.encoding)).mtime;
          } catch (err) {
            if (errorOf(err).code === 'fileChanged') stopped = true;
            failed(err);
          }
        });
      }, failed);
    } else if (db) {
      api.dbScript(db).then((text) => ready(text, (next) => api.dbScriptSave(db, next).then(() => undefined, failed)), failed);
    }
    return () => {
      live = false;
      flushDoc();
      docWrite.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  const schemaOpen = !!db && !!state.schema;
  // Loaded (which connects) as soon as a database is chosen, panel open or not: the editor completes from it.
  const { schema, loading: schemaLoading, error: schemaError, setOwner, reload: reloadSchema, sqlSchema } = useSqlSchema(db);

  // The panel shows its own state; closed, the log tells why completions are missing.
  useEffect(() => {
    if (!schemaLoading) runner.refreshStatus();
    if (schemaError && !schemaOpen) runner.log(t('workbench.log.schemaFailed', { message: errorMessage(schemaError) }), 'err');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaLoading, schemaError]);

  const run = () => runner.run(editor.current?.getRunText() ?? query, 'statement');
  const runAll = () => runner.run(query, 'all');
  const format = () => editor.current?.format(withWorkbenchDefaults(settings.workbench).format);
  useCommand(commandById('workbench.format'), format);

  const { cols, tableRows, selection, log, setActionError, shown, status } = runner;
  const exportCols = () => cols.map((c) => ({ label: c.label, value: c.value }));

  const exportCsv = async () => {
    setActionError(undefined);
    try {
      const { path } = await api.saveTarget();
      if (!path) return;
      await api.saveDemo(path, toCsv(exportCols(), tableRows.slice(0, EXPORT_ROWS)));
      log(t('workbench.log.exported', { count: Math.min(tableRows.length, EXPORT_ROWS), path }), 'ok');
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const disconnect = async () => {
    if (status?.pending && !(await confirm({ title: t('workbench.tx.disconnect'), body: t('workbench.tx.disconnectConfirm'), okLabel: t('workbench.tx.disconnect'), danger: true }))) return;
    await runner.disconnect();
  };

  const pickTable = (table: DbSchemaTable, tableOwner: string) => {
    const quote = (name: string) => (/^[A-Z][A-Z0-9_$#]*$/.test(name) ? name : `"${name}"`);
    edit(`select * from ${quote(tableOwner)}.${quote(table.name)}`);
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
          <button className="btn btn-primary btn-sm" data-run onClick={run} disabled={busy}>
            <Icon name="play" /> {t('workbench.run')}
          </button>
          <button className="btn btn-sm" onClick={runAll} disabled={busy} title={t('workbench.runAll.title')}>
            <Icon name="play" /> {t('workbench.runAll')}
          </button>
          <button className="btn btn-sm" onClick={format}>{t('workbench.format')}</button>
          {runner.running && <button className="btn btn-sm" onClick={runner.cancel}>{t('workbench.cancel')}</button>}
          {db && (
            <>
              <button className="btn btn-sm" onClick={() => update((cur) => ({ schema: !cur.schema }))} aria-pressed={!!state.schema}>
                <Icon name="table" /> {t('workbench.schema')}
              </button>
              {status?.pending && <Badge tone="warn">{t('workbench.tx.pending')}</Badge>}
              <button className="btn btn-sm" onClick={runner.commit} disabled={!status?.connected || starting}>{t('workbench.tx.commit')}</button>
              <button className="btn btn-sm" onClick={runner.rollback} disabled={!status?.connected || starting}>{t('workbench.tx.rollback')}</button>
              <button className="btn btn-sm" onClick={disconnect} disabled={!status?.connected || starting}>{t('workbench.tx.disconnect')}</button>
            </>
          )}
          <button className="btn btn-sm" onClick={exportCsv} disabled={tableRows.length === 0}>{t('workbench.export')}</button>
          <button className="btn btn-sm" onClick={runner.copy} disabled={tableRows.length === 0}>{t(selection.length > 0 ? 'workbench.copySelected' : 'workbench.copy')}</button>
          {doc.kind === 'file' && (
            <>
              <span className="muted" title={doc.path}>{t('workbench.doc.file', { name: docName })}</span>
              <button className="btn btn-sm" onClick={() => update(() => ({ doc: { kind: 'default' } }))}>{t('workbench.doc.default')}</button>
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
        />
      )}
      <SplitView
        direction="column"
        sizes={[sizes.main[0], sizes.main[1]]}
        defaultSizes={DEFAULT_MAIN}
        onResize={(s) => update((cur) => ({ sizes: { ...(cur.sizes ?? sizes), main: [s[0], s[1]] } }))}
      >
        <div key="editor" className="wb-pane">
          <CodeEditor ref={editor} value={query} lang="sql" sqlDialect="plsql" sqlSchema={sqlSchema} onChange={edit} onRun={runner.run} height="100%" />
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
      </div>
      {managing && <Connections onClose={() => setManaging(false)} onChanged={connections.reload} />}
    </div>
  );
}
