import { useRef, useState } from 'react';
import { draftToSpec, emptyDraft, type HttpRequestDraft, RequestEditor, ResponseView } from '@deckbuilder/editor';
import type { HttpResponseInfo } from '@deckbuilder/server-core/protocol';
import { type ApiError, ErrorBanner, errorOf, Icon, PageHead, SplitView, useAsync, useDebouncedSave, useDialogs } from '@deckbuilder/ui';
import { api, type RestSettings, type SavedRequest, type Settings } from '../api';
import { t } from '../i18n';

const DEFAULT_MAIN: [number, number] = [0.5, 0.5];

export function RestScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const saved = useAsync(() => api.requests(), []);
  const { confirm, prompt, element } = useDialogs();
  const [state, setState] = useState<RestSettings>(settings.rest ?? {});
  const [draft, setDraft] = useState<HttpRequestDraft>(emptyDraft);
  const [loaded, setLoaded] = useState<SavedRequest>();
  const [auth, setAuth] = useState('');
  const [response, setResponse] = useState<HttpResponseInfo>();
  const [error, setError] = useState<ApiError>();
  const [actionError, setActionError] = useState<ApiError>();
  const [sending, setSending] = useState(false);
  const [savedPath, setSavedPath] = useState<string>();
  const controller = useRef<AbortController>();

  const persist = useDebouncedSave((next: RestSettings) => onSave({ rest: next }));
  const sizes = state.sizes?.main ?? DEFAULT_MAIN;

  const send = async () => {
    if (sending) return;
    const abort = new AbortController();
    controller.current = abort;
    setSending(true);
    setError(undefined);
    setSavedPath(undefined);
    try {
      setResponse(await api.httpSend(draftToSpec(draft), loaded?.id, abort.signal));
    } catch (err) {
      if (!abort.signal.aborted) {
        setResponse(undefined);
        setError(errorOf(err));
      }
    } finally {
      if (controller.current === abort) setSending(false);
    }
  };
  const cancel = () => {
    controller.current?.abort();
    setSending(false);
  };

  const load = (item: SavedRequest) => {
    setLoaded(item);
    setDraft(item.request);
    setAuth('');
  };
  const reset = () => {
    setLoaded(undefined);
    setDraft(emptyDraft());
    setAuth('');
  };

  const save = async (asNew: boolean) => {
    setActionError(undefined);
    try {
      let name = loaded?.name;
      if (asNew || !loaded) {
        name =
          (await prompt({
            title: t('rest.saveAsTitle'),
            label: t('rest.name'),
            value: loaded?.name ?? '',
            validate: (v) => (v.trim() ? null : t('error.badRequestName')),
          })) ?? undefined;
        if (!name) return;
      }
      const input = { name, request: draft, ...(auth ? { auth } : {}) };
      const record = asNew || !loaded ? await api.createRequest(input) : await api.updateRequest(loaded.id, input);
      setLoaded(record);
      setAuth('');
      saved.reload();
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const remove = async (item: SavedRequest) => {
    if (!(await confirm({ title: t('rest.deleteTitle', { name: item.name }), okLabel: t('rest.delete'), danger: true }))) return;
    setActionError(undefined);
    try {
      await api.deleteRequest(item.id);
      if (loaded?.id === item.id) reset();
      saved.reload();
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const saveResponse = async (info: HttpResponseInfo) => {
    setActionError(undefined);
    try {
      const { path } = await api.httpSave(info.id);
      if (path) setSavedPath(path);
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  return (
    <div className="content">
      <PageHead crumb={t('rest.crumb')} title={t('nav.rest')}>
        <div className="row">
          <button className="btn btn-sm" onClick={() => save(false)}>{t('rest.save')}</button>
          <button className="btn btn-sm" onClick={() => save(true)}>{t('rest.saveAs')}</button>
        </div>
      </PageHead>
      {actionError && <ErrorBanner error={actionError} compact />}
      <div className="rest-body">
        <aside className="rest-list">
          <div className="rest-list-head">
            <span className="mono-label">{t('rest.saved')}</span>
            <button className="btn btn-sm" onClick={reset}><Icon name="plus" /> {t('rest.new')}</button>
          </div>
          {saved.error && <ErrorBanner error={saved.error} onRetry={saved.reload} compact />}
          {saved.data?.length === 0 && <p className="muted">{t('rest.none')}</p>}
          {saved.data?.map((item) => (
            <div key={item.id} className={`rest-item${item.id === loaded?.id ? ' active' : ''}`}>
              <button className="rest-item-main" onClick={() => load(item)} title={item.request.url}>
                <span className="rest-method">{item.request.method}</span>
                <span className="rest-item-name">{item.name}</span>
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(item)} aria-label={t('rest.delete')} title={t('rest.delete')}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </aside>
        <SplitView
          direction="column"
          sizes={[sizes[0], sizes[1]]}
          defaultSizes={DEFAULT_MAIN}
          onResize={(s) => {
            const next = { ...state, sizes: { main: [s[0], s[1]] as [number, number] } };
            setState(next);
            persist(next);
          }}
        >
          <div key="request" className="rest-pane">
            <RequestEditor value={draft} onChange={setDraft} onSend={send} onCancel={cancel} sending={sending} />
            <label className="field rest-auth">
              <span className="mono-label">{t('rest.auth')}</span>
              <input
                type="password"
                value={auth}
                disabled={!loaded}
                placeholder={loaded?.auth?.hasSecret ? t('rest.authSaved') : ''}
                onChange={(e) => setAuth(e.target.value)}
                autoComplete="off"
              />
              <span className="muted">{loaded ? t('rest.authHint') : t('rest.authNeedsSave')}</span>
            </label>
          </div>
          <div key="response" className="rest-pane">
            {savedPath && <p className="muted">{t('rest.responseSaved', { path: savedPath })}</p>}
            <ResponseView response={response} error={error} sending={sending} onSave={response ? () => saveResponse(response) : undefined} />
          </div>
        </SplitView>
      </div>
      {element}
    </div>
  );
}
