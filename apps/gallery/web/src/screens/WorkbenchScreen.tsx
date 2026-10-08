import { useEffect, useRef, useState } from 'react';
import { CodeEditor } from '@deckbuilder/editor';
import {
  type ApiError,
  DataTable,
  type DataTableColumn,
  errorMessage,
  errorOf,
  ErrorBanner,
  type FieldSpec,
  Icon,
  type OutputLine,
  OutputPanel,
  PageHead,
  ResourceForm,
  SplitView,
  toCsv,
  useAsync,
  useDebouncedSave,
  useStream,
} from '@deckbuilder/ui';
import { api, type DemoRow, type Settings, type WorkbenchSettings } from '../api';
import { t } from '../i18n';

const SAMPLE = 'select * from rows;';
const ROW_COUNT = 50_000;
const EXPORT_ROWS = 10_000;
const PROGRESS_EVERY = 10_000;
const DEFAULT_MAIN: [number, number] = [0.3, 0.7];
const DEFAULT_RESULTS: [number, number] = [0.65, 0.35];

const columns = (): DataTableColumn<DemoRow>[] => [
  { id: 'id', label: 'id', width: 80, value: (r) => r.id, align: 'right' },
  { id: 'name', label: 'name', width: 200, value: (r) => r.name },
  { id: 'amount', label: 'amount', width: 120, value: (r) => r.amount, align: 'right' },
  { id: 'date', label: 'date', width: 140, value: (r) => r.date },
];

export function WorkbenchScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [state, setState] = useState<WorkbenchSettings>(settings.workbench ?? {});
  const [query, setQuery] = useState(SAMPLE);
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [actionError, setActionError] = useState<ApiError>();
  const rows = useStream<DemoRow>({ maxItems: ROW_COUNT });
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

  const log = (text: string, tone?: OutputLine['tone']) => setLines((l) => [...l, { text, tone, at: Date.now() }]);

  const run = () => {
    if (rows.running) return;
    cancelled.current = false;
    reported.current = 0;
    setActionError(undefined);
    log(t('workbench.log.start', { query: query.trim() }));
    rows.start('/api/demo/rows', { count: ROW_COUNT });
  };
  const cancel = () => {
    cancelled.current = true;
    rows.cancel();
  };

  // Progress lines every 10 000 rows, then one line when the stream ends.
  useEffect(() => {
    while (rows.running && rows.items.length >= reported.current + PROGRESS_EVERY) {
      reported.current += PROGRESS_EVERY;
      log(t('workbench.log.progress', { count: reported.current }));
    }
    if (wasRunning.current && !rows.running) {
      if (cancelled.current) log(t('workbench.log.cancelled', { count: rows.items.length }), 'warn');
      else if (rows.error) log(errorMessage(rows.error), 'err');
      else log(t('workbench.log.done', { count: rows.items.length }), 'ok');
    }
    wasRunning.current = rows.running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.items.length, rows.running]);

  const exportCsv = async () => {
    setActionError(undefined);
    try {
      const { path } = await api.saveTarget();
      if (!path) return;
      const cols = columns().map((c) => ({ label: c.label, value: c.value }));
      await api.saveDemo(path, toCsv(cols, rows.items.slice(0, EXPORT_ROWS)));
      log(t('workbench.log.exported', { count: Math.min(rows.items.length, EXPORT_ROWS), path }), 'ok');
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const sizes = state.sizes ?? { main: DEFAULT_MAIN, results: DEFAULT_RESULTS };
  const cols = columns();

  return (
    <div className="content">
      <PageHead crumb={t('workbench.crumb')} title={t('nav.workbench')}>
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={run} disabled={rows.running}>
            <Icon name="play" /> {t('workbench.run')}
          </button>
          {rows.running && <button className="btn btn-sm" onClick={cancel}>{t('workbench.cancel')}</button>}
          <button className="btn btn-sm" onClick={exportCsv} disabled={rows.items.length === 0}>{t('workbench.export')}</button>
          <span className="muted">{t('workbench.exportHint', { count: EXPORT_ROWS })}</span>
        </div>
      </PageHead>
      {actionError && <ErrorBanner error={actionError} compact />}
      <SplitView
        direction="column"
        sizes={[sizes.main[0], sizes.main[1]]}
        defaultSizes={DEFAULT_MAIN}
        onResize={(s) => update((cur) => ({ sizes: { ...(cur.sizes ?? sizes), main: [s[0], s[1]] } }))}
      >
        <div key="editor" className="wb-pane">
          <CodeEditor value={query} lang="sql" onChange={setQuery} onRun={run} height="100%" />
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
                columns={cols}
                rows={rows.items}
                rowKey={(r) => String(r.id)}
                widths={state.widths}
                onWidthsChange={(widths) => update(() => ({ widths }))}
              />
            </div>
            <div key="output" className="wb-pane">
              <OutputPanel lines={lines} onClear={() => setLines([])} />
            </div>
          </SplitView>
        </div>
      </SplitView>
      <TokenCard />
    </div>
  );
}

/** One demo record whose token lives in the secret store; the UI only learns that it is saved. */
function TokenCard() {
  const secrets = useAsync(() => api.demoSecrets(), []);
  const [error, setError] = useState<ApiError>();
  const record = secrets.data?.[0];
  const fields: FieldSpec[] = [{ key: 'token', label: t('workbench.token'), kind: 'password' }];

  const submit = async (values: Record<string, unknown>) => {
    setError(undefined);
    try {
      if (record) await api.updateDemoSecret(record.id, values);
      else await api.createDemoSecret(values);
      secrets.reload();
    } catch (err) {
      setError(errorOf(err));
    }
  };

  if (!secrets.data) return null;
  return (
    <section className="card wb-token">
      <h4 className="mono-label">{t('workbench.tokenTitle')}</h4>
      <ResourceForm key={record?.id ?? 'new'} fields={fields} value={{ ...record }} onSubmit={submit} onCancel={() => {}} error={error} />
    </section>
  );
}
