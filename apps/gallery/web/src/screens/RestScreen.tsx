import { useEffect, useState } from 'react';
import { draftToSpec, type HttpRequestDraft, type ImportedRequest, RequestEditor, ResponseView, toCurl } from '@deckbuilder/editor';
import type { HttpResponseInfo } from '@deckbuilder/server-core/protocol';
import { type ApiError, ErrorBanner, errorOf, Icon, PageHead, SplitView, useAsync, useDebouncedSave, useDialogs } from '@deckbuilder/ui';
import { api, type RestSettings, type SavedRequest, type Settings } from '../api';
import { t } from '../i18n';
import { ImportDialog, requestLabel } from './rest/ImportDialog';
import { CurlDialog } from './rest/CurlDialog';
import { RestTabBar } from './rest/RestTabBar';
import { restTabs, runtimeOf, useRestTabs } from './rest/tabs-store';

const MAX_NAME = 80;

/** `name`, or `name (2)`, `name (3)`… when taken; the result stays within the name limit. */
function uniqueName(name: string, taken: Set<string>): string {
  const base = name.trim().slice(0, MAX_NAME) || 'Request';
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, MAX_NAME - suffix.length) + suffix;
  }
  return candidate;
}

const DEFAULT_MAIN: [number, number] = [0.5, 0.5];

export function RestScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const saved = useAsync(() => api.requests(), []);
  const { confirm, prompt, element } = useDialogs();
  const [state, setState] = useState<RestSettings>(settings.rest ?? {});
  const { tabs, active, full } = useRestTabs();
  useEffect(() => restTabs.setSaved(saved.data), [saved.data]);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const draft = tab.draft;
  const loaded = tab.savedId ? saved.data?.find((r) => r.id === tab.savedId) : undefined;
  const { auth, imported, response, error, sending, savedPath } = runtimeOf(tab.id);
  const [importing, setImporting] = useState(false);
  const [curl, setCurl] = useState<string>();
  const [actionError, setActionError] = useState<ApiError>();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const persist = useDebouncedSave((next: RestSettings) => onSave({ rest: next }));
  const sizes = state.sizes?.main ?? DEFAULT_MAIN;

  const setDraft = (next: HttpRequestDraft) => restTabs.update(tab.id, { draft: next });
  const setAuth = (value: string) => restTabs.setRuntime(tab.id, { auth: value });
  const send = () => void restTabs.send(tab.id);
  const cancel = () => restTabs.cancel(tab.id);

  const loadImported = (item: ImportedRequest) => restTabs.loadImported(tab.id, item.draft, item.name ?? '', item.auth);

  const saveImported = async (items: ImportedRequest[]) => {
    const taken = new Set((saved.data ?? []).map((r) => r.name));
    try {
      for (const item of items) {
        const name = uniqueName(requestLabel(item), taken);
        taken.add(name);
        await api.createRequest({ name, request: item.draft, ...(item.auth ? { auth: item.auth } : {}) });
      }
    } finally {
      saved.reload();
    }
  };

  const save = async (asNew: boolean) => {
    const { id, savedId } = tab;
    setActionError(undefined);
    try {
      let name = loaded?.name ?? tab.title;
      if (asNew || !savedId || !name) {
        name =
          (await prompt({
            title: t('rest.saveAsTitle'),
            label: t('rest.name'),
            value: name ?? imported?.name ?? '',
            validate: (v) => (v.trim() ? null : t('error.badRequestName')),
          })) ?? undefined;
        if (!name) return;
      }
      const input = { name, request: draft, ...(auth ? { auth } : {}) };
      const record = asNew || !savedId ? await api.createRequest(input) : await api.updateRequest(savedId, input);
      restTabs.markSaved(id, record);
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
      restTabs.savedChanged(item.id);
      saved.reload();
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const rename = async (item: SavedRequest) => {
    const name = await prompt({
      title: t('rest.renameTitle'),
      label: t('rest.name'),
      value: item.name,
      validate: (v) => (v.trim() ? null : t('error.badRequestName')),
    });
    if (!name || name.trim() === item.name) return;
    setActionError(undefined);
    try {
      const record = await api.updateRequest(item.id, { name, request: item.request });
      restTabs.savedChanged(item.id, record);
      saved.reload();
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const moveTo = async (fromId: string, toId: string) => {
    const ids = (saved.data ?? []).map((r) => r.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setActionError(undefined);
    try {
      await api.reorderRequests(ids);
    } catch (err) {
      setActionError(errorOf(err));
    } finally {
      saved.reload();
    }
  };

  const showCurl = () => {
    const spec = draftToSpec(draft);
    if (auth && !spec.headers.some(([name]) => name.toLowerCase() === 'authorization')) spec.headers.push(['Authorization', auth]);
    setCurl(toCurl(spec));
  };

  const saveResponse = async (info: HttpResponseInfo) => {
    const id = tab.id;
    setActionError(undefined);
    try {
      const { path } = await api.httpSave(info.id);
      if (path) restTabs.setRuntime(id, { savedPath: path });
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  return (
    <div className="content">
      <PageHead title={t('nav.rest')}>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setImporting(true)}>{t('rest.import')}</button>
          <button className="btn btn-sm" onClick={showCurl}>{t('rest.code')}</button>
          <button className="btn btn-sm" onClick={() => save(false)}>{t('rest.save')}</button>
          <button className="btn btn-sm" onClick={() => save(true)}>{t('rest.saveAs')}</button>
        </div>
      </PageHead>
      {actionError && <ErrorBanner error={actionError} compact />}
      {full && <p className="muted" role="status">{t('rest.tab.full')}</p>}
      <div className="rest-body">
        <aside className="rest-list">
          <div className="rest-list-head">
            <span className="mono-label">{t('rest.saved')}</span>
            <button className="btn btn-sm" onClick={restTabs.newTab}><Icon name="plus" /> {t('rest.new')}</button>
          </div>
          {saved.error && <ErrorBanner error={saved.error} onRetry={saved.reload} compact />}
          {saved.data?.length === 0 && <p className="muted">{t('rest.none')}</p>}
          {saved.data?.map((item) => (
            <div
              key={item.id}
              className={`rest-item${item.id === tab.savedId ? ' active' : ''}${item.id === dragOver ? ' drop-target' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
                setDragId(item.id);
              }}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                setDragOver(item.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId !== null) void moveTo(dragId, item.id);
                setDragId(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOver(null);
              }}
            >
              <button className="rest-item-main" onClick={() => restTabs.openSaved(item)} title={item.request.url}>
                <span className="rest-method">{item.request.method}</span>
                <span className="rest-item-name">{item.name}</span>
              </button>
              <span className="rest-item-actions">
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => rename(item)} aria-label={t('rest.rename')} title={t('rest.rename')}>
                  <Icon name="edit" />
                </button>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(item)} aria-label={t('rest.delete')} title={t('rest.delete')}>
                  <Icon name="trash" />
                </button>
              </span>
            </div>
          ))}
        </aside>
        <div className="rest-main">
        <RestTabBar tabs={tabs} active={tab.id} saved={saved.data} />
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
            <RequestEditor
              value={draft}
              onChange={setDraft}
              onSend={send}
              onCancel={cancel}
              sending={sending}
              headersFooter={(
                <label className="field rest-auth">
                  <span className="mono-label">{t('rest.auth')}</span>
                  <input
                    type="password"
                    value={auth}
                    disabled={!tab.savedId && !imported?.auth}
                    placeholder={loaded?.auth?.hasSecret ? t('rest.authSaved') : ''}
                    onChange={(e) => setAuth(e.target.value)}
                    autoComplete="off"
                  />
                  <span className="muted">
                    {tab.savedId ? t('rest.authHint') : imported?.auth ? t('rest.authImported') : t('rest.authNeedsSave')}
                  </span>
                </label>
              )}
            />
          </div>
          <div key="response" className="rest-pane">
            {savedPath && <p className="muted">{t('rest.responseSaved', { path: savedPath })}</p>}
            <ResponseView response={response} error={error} sending={sending} onSave={response ? () => saveResponse(response) : undefined} />
          </div>
        </SplitView>
        </div>
      </div>
      {importing && <ImportDialog onLoad={loadImported} onSaveMany={saveImported} onClose={() => setImporting(false)} />}
      {curl !== undefined && <CurlDialog curl={curl} onClose={() => setCurl(undefined)} />}
      {element}
    </div>
  );
}
