import type { HttpResponseInfo } from '@deckbuilderkit/server-core/protocol';
import { type ApiError, Badge, CopyButton, ErrorBanner, formatBytes, Icon, JsonTree, PanelBanner, PanelNotice, Spinner, t } from '@deckbuilderkit/ui';
import { useMemo, useState } from 'react';
import { CodeView } from './CodeView';
import { bodyView, formatMs, statusTone } from './http';

export interface ResponseViewProps {
  response?: HttpResponseInfo;
  error?: ApiError;
  sending?: boolean;
  onSave?(): void;
}

/** Status line, body (JSON tree, text or a binary notice) and headers of one HTTP response. */
export function ResponseView({ response, error, sending, onSave }: ResponseViewProps) {
  if (sending && !response) return <div className="resp-empty"><Spinner /></div>;
  if (error) return <div className="resp"><ErrorBanner error={error} /></div>;
  if (!response) {
    return <PanelNotice icon={<Icon name="send" size={20} />} title={t('http.noResponse')} message={t('http.noResponseMessage')} />;
  }
  return <ResponseBody response={response} sending={sending} onSave={onSave} />;
}

function ResponseBody({ response, sending, onSave }: { response: HttpResponseInfo; sending?: boolean; onSave?(): void }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  return (
    <div className="resp">
      <div className="resp-status">
        <Badge tone={statusTone(response.status)}>{`${response.status} ${response.statusText}`.trim()}</Badge>
        <span className="resp-meta" title={t('http.timing')}>{formatMs(response.ms)} / {formatMs(response.totalMs)}</span>
        <span className="resp-meta">{formatBytes(response.size)}</span>
        {response.redirected && <span className="resp-meta resp-url" title={response.url}>{response.url}</span>}
        <span className="spacer" />
        {sending && <Spinner small />}
        {onSave && (
          <button className="btn btn-sm" onClick={onSave}><Icon name="download" /> {t('http.save')}</button>
        )}
      </div>
      {response.truncated && <PanelBanner tone="warn" icon="alert">{t('http.truncated', { size: formatBytes(response.size) })}</PanelBanner>}
      <div className="req-tabs" role="tablist">
        {(['body', 'headers'] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`req-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {t(`http.tab.${id}`)}
            {id === 'headers' && <span className="req-tab-count">{response.headers.length}</span>}
          </button>
        ))}
      </div>
      <div className="resp-panel">
        {tab === 'body' ? <BodyPane response={response} /> : <HeadersPane headers={response.headers} />}
      </div>
    </div>
  );
}

function BodyPane({ response }: { response: HttpResponseInfo }) {
  const view = useMemo(() => bodyView(response), [response]);
  const [raw, setRaw] = useState(false);
  if (view.kind === 'binary') return <PanelNotice icon={<Icon name="cube" size={20} />} title={t('http.binary')} />;
  if (view.kind === 'text') return <div className="resp-body"><CodeView value={view.text} lang={view.lang} lineNumbers /></div>;
  return (
    <>
      <div className="file-preview-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => setRaw(!raw)} aria-pressed={raw}>{raw ? t('http.tree') : t('http.raw')}</button>
        <CopyButton text={view.pretty} />
      </div>
      <div className="resp-body">
        {raw ? <CodeView value={view.pretty} lang="json" lineNumbers /> : <JsonTree value={view.value} />}
      </div>
    </>
  );
}

function HeadersPane({ headers }: { headers: Array<[string, string]> }) {
  return (
    <>
      <div className="file-preview-bar">
        <CopyButton text={headers.map(([name, value]) => `${name}: ${value}`).join('\n')} label={t('http.copyAll')} />
      </div>
      <div className="resp-body">
        <table className="resp-headers">
          <thead><tr><th>{t('http.headerName')}</th><th>{t('http.headerValue')}</th></tr></thead>
          <tbody>
            {headers.map(([name, value], i) => <tr key={i}><td>{name}</td><td>{value}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}
