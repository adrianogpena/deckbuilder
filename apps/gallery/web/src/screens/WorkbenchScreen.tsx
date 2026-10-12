import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '@deckbuilder/editor';
import {
  type ApiError,
  Badge,
  DataTable,
  type DataTableColumn,
  errorMessage,
  errorOf,
  ErrorBanner,
  Icon,
  type OutputLine,
  OutputPanel,
  PageHead,
  SplitView,
  copyText,
  toCsv,
  toTsv,
  useAsync,
  useDebouncedSave,
  useDialogs,
  useStream,
} from '@deckbuilder/ui';
import { api, type DbColumn, type DbSchemaTable, type DbStatus, type DemoRow, type Settings, type WorkbenchSettings } from '../api';
import { t } from '../i18n';
import { Connections } from './workbench/Connections';
import { SchemaPanel } from './workbench/SchemaPanel';

const SAMPLE = 'select * from rows;';
const DEMO_SOURCE = 'demo';
const MANAGE = '::manage';
const ROW_COUNT = 50_000;
const MAX_STREAM_ITEMS = 100_001;
const DEFAULT_MAX_ROWS = 1000;
const MAX_ROWS_LIMIT = 100_000;
const EXPORT_ROWS = 10_000;
const PROGRESS_EVERY = 10_000;
const DEFAULT_MAIN: [number, number] = [0.3, 0.7];
const DEFAULT_RESULTS: [number, number] = [0.65, 0.35];
const BANNER_CODES = ['dbLogin', 'dbUnreachable'];

interface TableRow {
  key: string;
  cells: unknown[];
}

/** What the table shows: nothing yet, the demo rows, or the columns of one database result. */
type Shown = { kind: 'none' } | { kind: 'demo' } | { kind: 'db'; run: string; columns: DbColumn[] };

const demoColumns = (): DataTableColumn<TableRow>[] => [
  { id: 'id', label: 'id', width: 80, value: (r) => r.cells[0], align: 'right' },
  { id: 'name', label: 'name', width: 200, value: (r) => r.cells[1] },
  { id: 'amount', label: 'amount', width: 120, value: (r) => r.cells[2], align: 'right' },
  { id: 'date', label: 'date', width: 140, value: (r) => r.cells[3] },
];

const dbTableColumns = (columns: DbColumn[]): DataTableColumn<TableRow>[] =>
  columns.map((c, i) => ({
    id: `c${i}`,
    label: c.name,
    width: c.type === 'number' ? 120 : 160,
    value: (r) => r.cells[i],
    align: c.type === 'number' ? 'right' : 'left',
  }));

const demoCells = (r: DemoRow) => [r.id, r.name, r.amount, r.date];
const isTruncatedMarker = (item: unknown) => typeof item === 'object' && item !== null && !Array.isArray(item) && '$truncated' in item;

export function WorkbenchScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [state, setState] = useState<WorkbenchSettings>(settings.workbench ?? {});
  const [query, setQuery] = useState(SAMPLE);
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [actionError, setActionError] = useState<ApiError>();
  const [selection, setSelection] = useState<string[]>([]);
  const [shown, setShown] = useState<Shown>({ kind: 'none' });
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<DbStatus>();
  const [managing, setManaging] = useState(false);
  const [owner, setOwner] = useState<string>();
  const rows = useStream<unknown>({ maxItems: MAX_STREAM_ITEMS });
  const connections = useAsync(() => api.dbConnections(), []);
  const { confirm, element: dialogs } = useDialogs();
  const cancelled = useRef(false);
  const reported = useRef(0);
  const wasRunning = useRef(false);

  const persist = useDebouncedSave((next: WorkbenchSettings) => onSave({ workbench: next }));
  const latest = useRef(state);
  const update = (patch: (s: WorkbenchSettings) => WorkbenchSettings) => {
    const next = { ...latest.current, ...patch(latest.current) };
    latest.current = next;
    setState(next);
    persist(next);
  };

  const connection = state.source && state.source !== DEMO_SOURCE ? connections.data?.find((c) => c.id === state.source) : undefined;
  const db = connection?.id;
  const maxRows = state.maxRows ?? DEFAULT_MAX_ROWS;
  const schemaOpen = !!db && !!state.schema;
  // Loaded (which connects) as soon as a database is chosen, panel open or not: the editor completes from it.
  const schema = useAsync(() => (db ? api.dbSchema(db, owner) : Promise.resolve(undefined)), [db, owner]);
  const sqlSchema = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const table of schema.data?.tables ?? []) out[table.name] = table.columns.map((c) => c.name);
    return out;
  }, [schema.data]);

  const log = (text: string, tone?: OutputLine['tone']) => setLines((l) => [...l, { text, tone, at: Date.now() }]);

  const truncated = rows.items.length > 0 && isTruncatedMarker(rows.items[rows.items.length - 1]);
  const tableRows = useMemo<TableRow[]>(() => {
    if (shown.kind === 'none') return [];
    const body = truncated ? rows.items.slice(0, -1) : rows.items;
    return body.map((item, i) => ({ key: String(i), cells: shown.kind === 'demo' ? demoCells(item as DemoRow) : (item as unknown[]) }));
  }, [rows.items, shown, truncated]);

  const cols = useMemo(() => (shown.kind === 'db' ? dbTableColumns(shown.columns) : demoColumns()), [shown]);

  const refreshStatus = (id: string) => {
    api.dbStatus(id).then(setStatus, () => {});
  };

  useEffect(() => {
    setStatus(undefined);
    if (db) refreshStatus(db);
  }, [db]);

  // The panel shows its own state; closed, the log tells why completions are missing.
  useEffect(() => {
    if (db && !schema.loading) refreshStatus(db);
    if (schema.error && !schemaOpen) log(t('workbench.log.schemaFailed', { message: errorMessage(schema.error) }), 'err');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.loading, schema.error]);

  const fail = (err: unknown) => {
    const error = errorOf(err);
    log(errorMessage(error), 'err');
    if (error.code && BANNER_CODES.includes(error.code)) setActionError(error);
  };

  const begin = () => {
    cancelled.current = false;
    reported.current = 0;
    setActionError(undefined);
    setSelection([]);
    log(t('workbench.log.start', { query: query.trim() }));
  };

  const runDemo = () => {
    begin();
    setShown({ kind: 'demo' });
    rows.start('/api/demo/rows', { count: ROW_COUNT });
  };

  const runDb = async (id: string) => {
    begin();
    setStarting(true);
    try {
      const result = await api.dbRun(id, query, maxRows);
      if (result.kind === 'rows') {
        setShown({ kind: 'db', run: result.run, columns: result.columns });
        rows.start('/api/db/rows', { run: result.run });
      } else {
        setShown({ kind: 'none' });
        log(result.rowsAffected === undefined ? t('workbench.log.executed') : t('workbench.log.affected', { count: result.rowsAffected }), 'ok');
        refreshStatus(id);
      }
    } catch (err) {
      fail(err);
      refreshStatus(id);
    } finally {
      setStarting(false);
    }
  };

  const run = () => {
    if (rows.running || starting) return;
    if (db) void runDb(db);
    else runDemo();
  };
  const cancel = () => {
    cancelled.current = true;
    rows.cancel();
  };

  // Progress lines every 10 000 rows, then one line when the stream ends.
  useEffect(() => {
    while (rows.running && tableRows.length >= reported.current + PROGRESS_EVERY) {
      reported.current += PROGRESS_EVERY;
      log(t('workbench.log.progress', { count: reported.current }));
    }
    if (wasRunning.current && !rows.running) {
      if (cancelled.current) log(t('workbench.log.cancelled', { count: tableRows.length }), 'warn');
      else if (rows.error) fail(rows.error);
      else {
        log(t('workbench.log.done', { count: tableRows.length }), 'ok');
        if (truncated) log(t('workbench.log.truncated', { count: tableRows.length }), 'warn');
      }
      if (db) refreshStatus(db);
    }
    wasRunning.current = rows.running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRows.length, rows.running]);

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

  const copyResults = async () => {
    const chosen = new Set(selection);
    const picked = selection.length > 0 ? tableRows.filter((r) => chosen.has(r.key)) : tableRows;
    if (await copyText(toTsv(exportCols(), picked))) log(t('workbench.log.copied', { count: picked.length }), 'ok');
    else log(t('workbench.log.copyFailed'), 'err');
  };

  const finishTransaction = async (op: 'commit' | 'rollback') => {
    if (!db) return;
    setActionError(undefined);
    try {
      setStatus(await (op === 'commit' ? api.dbCommit(db) : api.dbRollback(db)));
      log(t(op === 'commit' ? 'workbench.log.committed' : 'workbench.log.rolledBack'), 'ok');
    } catch (err) {
      fail(err);
    }
  };

  const disconnect = async () => {
    if (!db) return;
    if (status?.pending && !(await confirm({ title: t('workbench.tx.disconnect'), body: t('workbench.tx.disconnectConfirm'), okLabel: t('workbench.tx.disconnect'), danger: true }))) return;
    cancel();
    try {
      setStatus(await api.dbDisconnect(db));
      log(t('workbench.log.disconnected'), 'ok');
    } catch (err) {
      fail(err);
    }
  };

  const pickTable = (table: DbSchemaTable, tableOwner: string) => {
    const quote = (name: string) => (/^[A-Z][A-Z0-9_$#]*$/.test(name) ? name : `"${name}"`);
    setQuery(`select * from ${quote(tableOwner)}.${quote(table.name)}`);
  };

  const changeSource = (value: string) => {
    if (value === MANAGE) {
      setManaging(true);
      return;
    }
    cancel();
    setActionError(undefined);
    setSelection([]);
    setShown({ kind: 'none' });
    setOwner(undefined);
    update(() => ({ source: value }));
  };

  const sizes = state.sizes ?? { main: DEFAULT_MAIN, results: DEFAULT_RESULTS };
  const demoWidths = shown.kind !== 'db';
  const busy = rows.running || starting;

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
          {rows.running && <button className="btn btn-sm" onClick={cancel}>{t('workbench.cancel')}</button>}
          {db && (
            <>
              <label className="wb-maxrows">
                <span className="muted">{t('workbench.maxRows')}</span>
                <input
                  className="wb-max"
                  type="number"
                  min={1}
                  max={MAX_ROWS_LIMIT}
                  value={maxRows}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && n <= MAX_ROWS_LIMIT) update(() => ({ maxRows: n }));
                  }}
                />
              </label>
              <button className="btn btn-sm" onClick={() => update((cur) => ({ schema: !cur.schema }))} aria-pressed={!!state.schema}>
                <Icon name="table" /> {t('workbench.schema')}
              </button>
              {status?.pending && <Badge tone="warn">{t('workbench.tx.pending')}</Badge>}
              <button className="btn btn-sm" onClick={() => finishTransaction('commit')} disabled={!status?.connected || starting}>{t('workbench.tx.commit')}</button>
              <button className="btn btn-sm" onClick={() => finishTransaction('rollback')} disabled={!status?.connected || starting}>{t('workbench.tx.rollback')}</button>
              <button className="btn btn-sm" onClick={disconnect} disabled={!status?.connected || starting}>{t('workbench.tx.disconnect')}</button>
            </>
          )}
          <button className="btn btn-sm" onClick={exportCsv} disabled={tableRows.length === 0}>{t('workbench.export')}</button>
          <button className="btn btn-sm" onClick={copyResults} disabled={tableRows.length === 0}>{t(selection.length > 0 ? 'workbench.copySelected' : 'workbench.copy')}</button>
          <span className="muted">{t('workbench.exportHint', { count: EXPORT_ROWS })}</span>
      </div>
      </PageHead>
      {actionError && <ErrorBanner error={actionError} compact />}
      <div className="wb-body">
      {schemaOpen && (
        <SchemaPanel
          schema={schema.data}
          loading={schema.loading}
          error={schema.error}
          onOwner={setOwner}
          onReload={schema.reload}
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
          <CodeEditor value={query} lang="sql" sqlDialect="plsql" sqlSchema={sqlSchema} onChange={setQuery} onRun={run} height="100%" />
        </div>
        <div key="results" className="wb-pane">
          <SplitView
            direction="row"
            sizes={[sizes.results[0], sizes.results[1]]}
            defaultSizes={DEFAULT_RESULTS}
            onResize={(s) => update((cur) => ({ sizes: { ...(cur.sizes ?? sizes), results: [s[0], s[1]] } }))}
          >
            <div key="table" className="wb-pane">
              <DataTable
                key={shown.kind === 'db' ? shown.run : 'demo'}
                columns={cols}
                rows={tableRows}
                rowKey={(r) => r.key}
                selection={selection}
                onSelectionChange={setSelection}
                widths={demoWidths ? state.widths : undefined}
                onWidthsChange={demoWidths ? (widths) => update(() => ({ widths })) : undefined}
              />
            </div>
            <div key="output" className="wb-pane">
              <OutputPanel lines={lines} onClear={() => setLines([])} />
            </div>
          </SplitView>
        </div>
      </SplitView>
      </div>
      {managing && <Connections onClose={() => setManaging(false)} onChanged={connections.reload} />}
    </div>
  );
}
