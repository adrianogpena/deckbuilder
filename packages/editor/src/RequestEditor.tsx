import { HTTP_METHODS, type HttpMethod } from '@deckbuilder/server-core/protocol';
import { Icon, Spinner, t } from '@deckbuilder/ui';
import { useState } from 'react';
import { CodeEditor } from './CodeEditor';
import { type HttpHeaderDraft, type HttpRequestDraft, sendsBody } from './http';

type Tab = 'headers' | 'body' | 'options';
const TABS: Tab[] = ['headers', 'body', 'options'];

export interface RequestEditorProps {
  value: HttpRequestDraft;
  onChange(draft: HttpRequestDraft): void;
  onSend(): void;
  onCancel?(): void;
  sending: boolean;
}

/** Method, URL, headers, body and options of one HTTP request; sending is up to the app. */
export function RequestEditor({ value, onChange, onSend, onCancel, sending }: RequestEditorProps) {
  const [tab, setTab] = useState<Tab>('headers');
  const set = (patch: Partial<HttpRequestDraft>) => onChange({ ...value, ...patch });
  const enabledHeaders = value.headers.filter((h) => h.enabled && h.name.trim() !== '').length;

  return (
    <div className="req-editor">
      <div className="req-top">
        <select className="req-method" value={value.method} onChange={(e) => set({ method: e.target.value as HttpMethod })} aria-label={t('http.method')}>
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          className="req-url"
          value={value.url}
          placeholder="https://"
          spellCheck={false}
          aria-label={t('http.url')}
          onChange={(e) => set({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !sending) onSend();
          }}
        />
        {sending ? (
          <button className="btn" onClick={onCancel} disabled={!onCancel}>{t('dialog.cancel')}</button>
        ) : (
          <button className="btn btn-primary req-send" onClick={onSend} disabled={value.url.trim() === ''}>
            <Icon name="send" /> {t('http.send')}
          </button>
        )}
        {sending && <Spinner small />}
      </div>
      <div className="req-tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`req-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {t(`http.tab.${id}`)}
            {id === 'headers' && enabledHeaders > 0 && <span className="req-tab-count">{enabledHeaders}</span>}
          </button>
        ))}
      </div>
      <div className="req-panel">
        {tab === 'headers' && <HeadersTab headers={value.headers} onChange={(headers) => set({ headers })} />}
        {tab === 'body' && <BodyTab value={value} onChange={set} onSend={() => !sending && onSend()} />}
        {tab === 'options' && <OptionsTab value={value} onChange={set} />}
      </div>
    </div>
  );
}

const BLANK: HttpHeaderDraft = { name: '', value: '', enabled: true };

function HeadersTab({ headers, onChange }: { headers: HttpHeaderDraft[]; onChange(h: HttpHeaderDraft[]): void }) {
  const rows = [...headers, BLANK];
  const update = (i: number, patch: Partial<HttpHeaderDraft>) => {
    const next = rows.map((h, j) => (j === i ? { ...h, ...patch } : h));
    const last = next[next.length - 1];
    onChange(last.name === '' && last.value === '' ? next.slice(0, -1) : next);
  };
  return (
    <div className="req-headers">
      {rows.map((h, i) => {
        const isBlank = i === headers.length;
        return (
          <div key={i} className="req-header-row">
            <input type="checkbox" checked={h.enabled} disabled={isBlank} aria-label={t('http.headerEnabled')} onChange={(e) => update(i, { enabled: e.target.checked })} />
            <input value={h.name} placeholder={t('http.headerName')} spellCheck={false} aria-label={t('http.headerName')} onChange={(e) => update(i, { name: e.target.value })} />
            <input value={h.value} placeholder={t('http.headerValue')} spellCheck={false} aria-label={t('http.headerValue')} onChange={(e) => update(i, { value: e.target.value })} />
            <button
              className="btn btn-ghost btn-sm"
              disabled={isBlank}
              title={t('http.removeHeader')}
              aria-label={t('http.removeHeader')}
              onClick={() => onChange(headers.filter((_, j) => j !== i))}
            >
              <Icon name="close" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function BodyTab({ value, onChange, onSend }: { value: HttpRequestDraft; onChange(patch: Partial<HttpRequestDraft>): void; onSend(): void }) {
  const [formatError, setFormatError] = useState<string | null>(null);
  const bodyless = !sendsBody(value.method);
  const format = () => {
    try {
      onChange({ body: JSON.stringify(JSON.parse(value.body), null, 2) });
      setFormatError(null);
    } catch (err) {
      setFormatError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="req-body">
      <div className="req-body-bar">
        {(['json', 'text'] as const).map((lang) => (
          <button
            key={lang}
            className={`btn btn-sm${value.bodyLang === lang ? ' btn-primary' : ' btn-ghost'}`}
            aria-pressed={value.bodyLang === lang}
            onClick={() => {
              setFormatError(null);
              onChange({ bodyLang: lang });
            }}
          >
            {t(`http.lang.${lang}`)}
          </button>
        ))}
        <span className="spacer" />
        {value.bodyLang === 'json' && (
          <button className="btn btn-ghost btn-sm" onClick={format} disabled={value.body.trim() === ''}>{t('http.format')}</button>
        )}
      </div>
      {formatError && <span className="field-error">{t('preview.jsonError', { message: formatError })}</span>}
      {bodyless && <span className="req-hint">{t('http.bodyIgnored', { method: value.method })}</span>}
      <div className={bodyless ? 'req-body-editor disabled' : 'req-body-editor'}>
        <CodeEditor
          value={value.body}
          lang={value.bodyLang === 'json' ? 'json' : 'text'}
          height={200}
          placeholder={t('http.bodyPlaceholder')}
          onChange={(body) => {
            setFormatError(null);
            onChange({ body });
          }}
          onRun={onSend}
        />
      </div>
    </div>
  );
}

function OptionsTab({ value, onChange }: { value: HttpRequestDraft; onChange(patch: Partial<HttpRequestDraft>): void }) {
  const seconds = value.timeoutMs === undefined ? '' : String(Math.round(value.timeoutMs / 1000));
  return (
    <div className="req-options">
      <label className="field">
        <span>{t('http.timeout')}</span>
        <input
          type="number"
          min={1}
          max={300}
          value={seconds}
          placeholder="60"
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ timeoutMs: e.target.value === '' || !Number.isFinite(n) ? undefined : Math.min(300, Math.max(1, n)) * 1000 });
          }}
        />
      </label>
      <label className="req-check">
        <input type="checkbox" checked={value.followRedirects ?? true} onChange={(e) => onChange({ followRedirects: e.target.checked })} />
        <span>{t('http.followRedirects')}</span>
      </label>
      <label className="req-check">
        <input type="checkbox" checked={value.insecure ?? false} onChange={(e) => onChange({ insecure: e.target.checked })} />
        <span>{t('http.insecure')}</span>
      </label>
      {value.insecure && <span className="req-hint tone-warn">{t('http.insecureHint')}</span>}
    </div>
  );
}
