import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type CodeEditorHandle, type CodeEditorProps, curlAt, draftToSpec, type HttpHeaderDraft, type ImportedRequest, parseCurl, ResponseView } from '@deckbuilder/editor';
import type { HttpResponseInfo } from '@deckbuilder/server-core/protocol';
import { type ApiError, errorOf, Icon, PanelBanner, SplitView, type TabAction } from '@deckbuilder/ui';
import { api } from '../../api';
import { t } from '../../i18n';
import { warningText } from '../rest/ImportDialog';
import { openRestTab } from '../rest/tabs-store';
import type { ExplorerSqlProps } from './SqlPanel';

const DEFAULT_SPLIT: [number, number] = [0.6, 0.4];

interface Options {
  name: string;
  /** The text editor shows (not a preview). */
  active: boolean;
  draft: string;
  /** Shares the SQL props: split size and `go`. */
  sql?: ExplorerSqlProps;
}

const withAuth = (request: ImportedRequest): ImportedRequest['draft'] => {
  const { draft, auth } = request;
  if (!auth || draft.headers.some((h) => h.enabled && h.name.trim().toLowerCase() === 'authorization')) return draft;
  const header: HttpHeaderDraft = { name: 'Authorization', value: auth, enabled: true };
  return { ...draft, headers: [...draft.headers, header] };
};

/**
 * Curl commands of an Explorer `.curl` file: Run (selection or the command at the cursor) with the response in a panel below the editor,
 * and Open in REST. Only `.curl` files; the rest get nothing.
 */
export function useExplorerCurl({ name, active, draft, sql }: Options) {
  const enabled = !!sql && active && /\.curl$/i.test(name);
  const editor = useRef<CodeEditorHandle>(null);
  const abort = useRef<AbortController>();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpResponseInfo>();
  const [error, setError] = useState<ApiError>();
  const [notice, setNotice] = useState<{ tone: 'warn' | 'err'; text: string }>();

  useEffect(() => () => abort.current?.abort(), []);

  const resolve = (): ImportedRequest | undefined => {
    const handle = editor.current;
    const selected = handle?.getSelectionText() ?? '';
    const source = selected.trim() !== '' ? selected : curlAt(draft, handle?.view?.state.selection.main.head ?? 0)?.text;
    try {
      if (source === undefined) throw new Error('notCurl');
      const request = parseCurl(source);
      setNotice(request.warnings.length > 0 ? { tone: 'warn', text: request.warnings.map(warningText).join(' ') } : undefined);
      return request;
    } catch (err) {
      setNotice({ tone: 'err', text: err instanceof Error && err.message === 'notCurl' ? t('explorer.curl.notCurl') : errorOf(err).message });
      setOpen(true);
      return undefined;
    }
  };

  const run = async () => {
    if (sending) return;
    const request = resolve();
    if (!request) return;
    const controller = new AbortController();
    abort.current = controller;
    setOpen(true);
    setSending(true);
    setError(undefined);
    setResponse(undefined);
    try {
      const result = await api.httpSend(draftToSpec(withAuth(request)), undefined, controller.signal, { environment: sql?.restEnvironment || undefined });
      if (!controller.signal.aborted) setResponse(result);
    } catch (err) {
      if (!controller.signal.aborted) setError(errorOf(err));
    } finally {
      if (abort.current === controller) {
        abort.current = undefined;
        setSending(false);
      }
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = undefined;
    setSending(false);
  };

  const saveResponse = async (info: HttpResponseInfo) => {
    try {
      await api.httpSave(info.id);
    } catch (err) {
      setNotice({ tone: 'err', text: errorOf(err).message });
    }
  };

  const openInRest = () => {
    if (!sql) return;
    const request = resolve();
    if (!request) return;
    if (openRestTab(request.draft, request.auth, request.name) === null) {
      setNotice({ tone: 'err', text: t('rest.tab.full') });
      setOpen(true);
      return;
    }
    sql.go('rest');
  };

  const actions: TabAction[] = enabled ? [
    { id: 'curl.run', group: 'primary', icon: 'play', label: t('workbench.run'), hint: 'Ctrl+Enter', disabled: sending, run: () => void run() },
    { id: 'curl.openRest', group: 'primary', icon: 'send', label: t('explorer.curl.openRest'), run: openInRest },
  ] : [];

  const editorProps: Pick<CodeEditorProps, 'onRun'> = enabled ? { onRun: () => void run() } : {};

  /** `editorNode` alone, or for `.curl` files with the response panel below. */
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
          <div key="response" className="wb-pane">
            <div className="xp-bar">
              <Icon name="send" size={12} />
              <span className="spacer" />
              {sending && <button className="btn btn-sm" onClick={cancel}>{t('workbench.cancel')}</button>}
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setOpen(false)} title={t('explorer.curl.close')} aria-label={t('explorer.curl.close')}>
                <Icon name="close" />
              </button>
            </div>
            {notice && <PanelBanner tone={notice.tone}>{notice.text}</PanelBanner>}
            <ResponseView response={response} error={error} sending={sending} onSave={response ? () => void saveResponse(response) : undefined} />
          </div>
        )}
      </SplitView>
    );
  };

  return { enabled, editor, editorProps, actions, layout };
}
