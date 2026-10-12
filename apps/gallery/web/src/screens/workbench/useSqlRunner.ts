import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { type RunMode, splitStatements } from '@deckbuilder/editor';
import { type ApiError, type DataTableColumn, type OutputLine, copyText, errorMessage, errorOf, formatCell, useStream } from '@deckbuilder/ui';
import { api, type DbColumn, type DbStatus, type DemoRow, type ResultFormat, type WorkbenchSettings } from '../../api';
import { t } from '../../i18n';
import { type CopyColumn, formatCopy } from './copy-format';

const ROW_COUNT = 50_000;
const MAX_STREAM_ITEMS = 100_001;
const DEFAULT_MAX_ROWS = 1000;
const PROGRESS_EVERY = 10_000;
const BANNER_CODES = ['dbLogin', 'dbUnreachable'];

export interface TableRow {
  key: string;
  cells: unknown[];
}

/** What the table shows: nothing yet, the demo rows, or the columns of one database result. */
export type Shown = { kind: 'none' } | { kind: 'demo' } | { kind: 'db'; run: string; columns: DbColumn[] };

const demoColumns = (): DataTableColumn<TableRow>[] => [
  { id: 'id', label: 'id', width: 80, value: (r) => r.cells[0], align: 'right' },
  { id: 'name', label: 'name', width: 200, value: (r) => r.cells[1] },
  { id: 'amount', label: 'amount', width: 120, value: (r) => r.cells[2], align: 'right' },
  { id: 'date', label: 'date', width: 140, value: (r) => r.cells[3] },
];

const dbTableColumns = (columns: DbColumn[], format: ResultFormat): DataTableColumn<TableRow>[] =>
  columns.map((c, i) => {
    const cell = (r: TableRow) => formatCell(r.cells[i], c.type, format, c.timestamp ? 'timestamp' : 'date');
    return {
      id: `c${i}`,
      label: c.name,
      width: c.type === 'number' ? 120 : 160,
      value: (r) => r.cells[i],
      render: (r) => {
        const { text, dim } = cell(r);
        return dim ? createElement('span', { className: 'dtable-null' }, text) : text;
      },
      copy: (r) => cell(r).text,
      align: c.type === 'number' ? 'right' : 'left',
    };
  });

const demoCells = (r: DemoRow) => [r.id, r.name, r.amount, r.date];
const isTruncatedMarker = (item: unknown) => typeof item === 'object' && item !== null && !Array.isArray(item) && '$truncated' in item;

/** Runs SQL on connection `db` (the demo rows when undefined) and holds the result table, the log and the transaction state. */
export function useSqlRunner(db: string | undefined, settings: Pick<WorkbenchSettings, 'maxRows' | 'results'> & Partial<Pick<WorkbenchSettings, 'copyFormat'>>) {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [actionError, setActionError] = useState<ApiError>();
  const [selection, setSelection] = useState<string[]>([]);
  const [shown, setShown] = useState<Shown>({ kind: 'none' });
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<DbStatus>();
  const rows = useStream<unknown>({ maxItems: MAX_STREAM_ITEMS });
  const cancelled = useRef(false);
  const reported = useRef(0);
  const wasRunning = useRef(false);
  const lastSql = useRef<string>();

  const maxRows = settings.maxRows ?? DEFAULT_MAX_ROWS;

  const log = (text: string, tone?: OutputLine['tone']) => setLines((l) => [...l, { text, tone, at: Date.now() }]);

  const truncated = rows.items.length > 0 && isTruncatedMarker(rows.items[rows.items.length - 1]);
  const tableRows = useMemo<TableRow[]>(() => {
    if (shown.kind === 'none') return [];
    const body = truncated ? rows.items.slice(0, -1) : rows.items;
    return body.map((item, i) => ({ key: String(i), cells: shown.kind === 'demo' ? demoCells(item as DemoRow) : (item as unknown[]) }));
  }, [rows.items, shown, truncated]);

  const cols = useMemo(() => (shown.kind === 'db' ? dbTableColumns(shown.columns, settings.results) : demoColumns()), [shown, settings.results]);

  const refreshStatus = () => {
    if (db) api.dbStatus(db).then(setStatus, () => {});
  };

  useEffect(() => {
    setStatus(undefined);
    refreshStatus();
    window.addEventListener('focus', refreshStatus);
    return () => window.removeEventListener('focus', refreshStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

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
  };

  const runDemo = (sql: string) => {
    begin();
    log(t('workbench.log.start', { query: sql.trim() }));
    setShown({ kind: 'demo' });
    rows.start('/api/demo/rows', { count: ROW_COUNT });
  };

  /** Runs the statements in order, each logged; stops at the first error. Only the last result set is shown. */
  const runDb = async (id: string, statements: string[]) => {
    begin();
    setStarting(true);
    try {
      for (const [i, sql] of statements.entries()) {
        log(t('workbench.log.start', { query: sql.trim() }));
        lastSql.current = sql;
        const last = i === statements.length - 1;
        const result = await api.dbRun(id, sql, maxRows);
        if (result.kind === 'rows' && last) {
          setShown({ kind: 'db', run: result.run, columns: result.columns });
          rows.start('/api/db/rows', { run: result.run });
        } else if (result.kind === 'rows') {
          log(t('workbench.log.executed'), 'ok');
        } else {
          if (last) setShown({ kind: 'none' });
          log(result.rowsAffected === undefined ? t('workbench.log.executed') : t('workbench.log.affected', { count: result.rowsAffected }), 'ok');
        }
      }
      refreshStatus();
    } catch (err) {
      fail(err);
      refreshStatus();
    } finally {
      setStarting(false);
    }
  };

  const run = (text: string, mode: RunMode) => {
    if (rows.running || starting) return;
    if (!db) {
      runDemo(text);
      return;
    }
    const statements = mode === 'all' ? splitStatements(text).map((s) => s.text) : [text];
    if (statements.length === 0 || statements.every((s) => !s.trim())) return;
    void runDb(db, statements);
  };

  const cancel = () => {
    cancelled.current = true;
    rows.cancel();
  };

  /** Cancels and empties the table, e.g. when the connection changes. */
  const reset = () => {
    cancel();
    setActionError(undefined);
    setSelection([]);
    setShown({ kind: 'none' });
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
      refreshStatus();
    }
    wasRunning.current = rows.running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRows.length, rows.running]);

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

  /** Copies the selected rows (all when none is selected) in the copy format setting, and logs the outcome. */
  const copy = async () => {
    const chosen = new Set(selection);
    const picked = selection.length > 0 ? tableRows.filter((r) => chosen.has(r.key)) : tableRows;
    const columns: CopyColumn<TableRow>[] = cols.map((c, i) => ({
      label: c.label,
      text: (r) => String((c.copy ?? c.value)(r) ?? ''),
      raw: (r) => r.cells[i],
      type: shown.kind === 'db' ? shown.columns[i]?.type : undefined,
    }));
    if (await copyText(formatCopy(settings.copyFormat ?? 'tsv', columns, picked, lastSql.current))) log(t('workbench.log.copied', { count: picked.length }), 'ok');
    else log(t('workbench.log.copyFailed'), 'err');
  };

  /** Cancels the running query and closes the connection; the caller confirms a pending transaction first. */
  const disconnect = async () => {
    if (!db) return;
    cancel();
    try {
      setStatus(await api.dbDisconnect(db));
      log(t('workbench.log.disconnected'), 'ok');
    } catch (err) {
      fail(err);
    }
  };

  return {
    run,
    cancel,
    reset,
    busy: rows.running || starting,
    running: rows.running,
    starting,
    shown,
    cols,
    tableRows,
    truncated,
    selection,
    setSelection,
    lines,
    log,
    clearLog: () => setLines([]),
    actionError,
    setActionError,
    status,
    refreshStatus,
    commit: () => finishTransaction('commit'),
    rollback: () => finishTransaction('rollback'),
    disconnect,
    copy,
  };
}
