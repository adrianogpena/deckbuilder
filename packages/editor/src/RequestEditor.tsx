import { HTTP_MAX_FORM_FIELDS, HTTP_METHODS, HTTP_TIMEOUT_MAX_MS, HTTP_TIMEOUT_MIN_MS, type HttpMethod, type RestEnvVar, restVarRefs } from '@deckbuilder/server-core/protocol';
import { Icon, Spinner, t } from '@deckbuilder/ui';
import { type MouseEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from './CodeEditor';
import {
  type HttpHeaderDraft,
  type HttpRequestDraft,
  type QueryParam,
  authHeaderValue,
  formatXml,
  hasAuthHeader,
  headersFromText,
  headersToText,
  parseAuthValue,
  queryParams,
  sendsBody,
  timeoutFromSeconds,
  withQueryParams,
} from './http';
import { VarInput, useVarSuggest } from './VarSuggest';
import { variableAutocomplete, variableClass, variableHighlight, variableInfo } from './variables';

type Tab = 'params' | 'headers' | 'auth' | 'body' | 'options';
const TABS: Tab[] = ['params', 'headers', 'auth', 'body', 'options'];

/** The Authorization value the Auth tab edits; the app keeps it (e.g. as a secret), the draft holds only `authKind`. */
export interface RequestAuthProps {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  /** Shown in the empty fields, e.g. when a saved value exists but is not loaded. */
  placeholder?: string;
  /** Note under the fields (where the value is kept, why it is disabled). */
  hint?: ReactNode;
  /** A saved value exists that `value` does not hold (e.g. a write-only secret). */
  hasSaved?: boolean;
}

export interface RequestEditorProps {
  value: HttpRequestDraft;
  onChange(draft: HttpRequestDraft): void;
  onSend(): void;
  onCancel?(): void;
  sending: boolean;
  /** Extra content under the headers list (the Headers tab only). */
  headersFooter?: ReactNode;
  /** Enables the Auth tab. */
  auth?: RequestAuthProps;
  /** The active environment's variables; given, `{{name}}` in the URL and body is marked defined or undefined. */
  variables?: readonly RestEnvVar[];
}

/** Method, URL, headers, body and options of one HTTP request; sending is up to the app. */
export function RequestEditor({ value, onChange, onSend, onCancel, sending, headersFooter, auth, variables }: RequestEditorProps) {
  const [tab, setTab] = useState<Tab>('params');
  const params = queryParams(value.url);
  const set = (patch: Partial<HttpRequestDraft>) => onChange({ ...value, ...patch });
  const enabledHeaders = value.headers.filter((h) => h.enabled && h.name.trim() !== '').length;
  const canSend = value.url.trim() !== '';
  const send = () => {
    if (canSend && !sending) onSend();
  };

  return (
    <div className="req-editor">
      <div className="req-top">
        <select className="req-method" value={value.method} onChange={(e) => set({ method: e.target.value as HttpMethod })} aria-label={t('http.method')}>
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <UrlInput value={value.url} onChange={(url) => set({ url })} onEnter={send} variables={variables} />
        {sending ? (
          <button className="btn" onClick={onCancel} disabled={!onCancel}>{t('dialog.cancel')}</button>
        ) : (
          <button className="btn btn-primary req-send" onClick={send} disabled={!canSend}>
            <Icon name="send" /> {t('http.send')}
          </button>
        )}
        {sending && <Spinner small />}
      </div>
      <div className="req-tabs" role="tablist">
        {TABS.filter((id) => id !== 'auth' || auth).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`req-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {t(`http.tab.${id}`)}
            {id === 'params' && params.length > 0 && <span className="req-tab-count">{params.length}</span>}
            {id === 'headers' && enabledHeaders > 0 && <span className="req-tab-count">{enabledHeaders}</span>}
          </button>
        ))}
      </div>
      <div className="req-panel">
        {tab === 'params' && <ParamsTab params={params} onChange={(next) => set({ url: withQueryParams(value.url, next) })} variables={variables} />}
        {tab === 'headers' && (
          <>
            <HeadersTab headers={value.headers} onChange={(headers) => set({ headers })} authKind={authRowKind(value, auth)} variables={variables} />
            {headersFooter}
          </>
        )}
        {tab === 'auth' && auth && <AuthTab value={value} onChange={set} auth={auth} variables={variables} />}
        {tab === 'body' && <BodyTab value={value} onChange={set} onSend={send} variables={variables} />}
        {tab === 'options' && <OptionsTab value={value} onChange={set} />}
      </div>
    </div>
  );
}

/** The URL field; with `variables`, a mirror over the input marks each `{{name}}` and hovering one shows its value. */
function UrlInput({ value, onChange, onEnter, variables }: { value: string; onChange(url: string): void; onEnter(): void; variables?: readonly RestEnvVar[] }) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const refs = variables ? restVarRefs(value) : [];
  const suggest = useVarSuggest(variables, input, onChange);
  const sync = () => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(() => {
    const i = input.current;
    const m = mirror.current;
    if (!i || !m) return;
    const cs = getComputedStyle(i);
    Object.assign(m.style, { padding: cs.padding, borderWidth: cs.borderWidth, font: cs.font, letterSpacing: cs.letterSpacing });
    sync();
  });
  const segments: ReactNode[] = [];
  let at = 0;
  for (const r of refs) {
    const info = variableInfo(r.name, variables!);
    segments.push(value.slice(at, r.from), <span key={r.from} className={variableClass(info.defined)} data-title={info.title}>{value.slice(r.from, r.to)}</span>);
    at = r.to;
  }
  segments.push(value.slice(at));
  const hover = (e: MouseEvent<HTMLInputElement>) => {
    let title = '';
    for (const span of mirror.current?.querySelectorAll<HTMLElement>('[data-title]') ?? []) {
      const r = span.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right) title = span.dataset.title ?? '';
    }
    e.currentTarget.title = title;
  };
  return (
    <div className="req-url-wrap">
      <input
        ref={input}
        className="req-url"
        value={value}
        placeholder="https://"
        spellCheck={false}
        aria-label={t('http.url')}
        onChange={(e) => {
          onChange(e.target.value);
          suggest.update(e.target);
        }}
        onKeyDown={(e) => {
          if (suggest.keyDown(e)) return;
          if (e.key === 'Enter') onEnter();
        }}
        onBlur={suggest.close}
        onScroll={sync}
        onSelect={(e) => {
          sync();
          suggest.update(e.currentTarget);
        }}
        onMouseMove={refs.length ? hover : undefined}
      />
      {refs.length > 0 && <div ref={mirror} className="req-url-mirror" aria-hidden="true">{segments}</div>}
      {suggest.list}
    </div>
  );
}

const BLANK: HttpHeaderDraft = { name: '', value: '', enabled: true };

/** The Auth tab's kind when it sends an Authorization header the Headers tab does not list. */
function authRowKind(value: HttpRequestDraft, auth: RequestAuthProps | undefined): 'basic' | 'bearer' | undefined {
  if (!auth || hasAuthHeader(value.headers)) return undefined;
  const kind = value.authKind ?? parseAuthValue(auth.value).kind;
  if (!kind) return undefined;
  return auth.value !== '' || auth.hasSaved ? kind : undefined;
}

function HeadersTab({ headers, onChange, authKind, variables }: { headers: HttpHeaderDraft[]; onChange(h: HttpHeaderDraft[]): void; authKind?: 'basic' | 'bearer'; variables?: readonly RestEnvVar[] }) {
  const [bulk, setBulk] = useState<string | null>(null);
  const rows = [...headers, BLANK];
  const toggle = (
    <div className="req-body-bar">
      <span className="spacer" />
      <button
        className={`btn btn-sm${bulk !== null ? ' btn-primary' : ' btn-ghost'}`}
        aria-pressed={bulk !== null}
        onClick={() => setBulk(bulk === null ? headersToText(headers) : null)}
      >
        {t('http.bulkEdit')}
      </button>
    </div>
  );
  if (bulk !== null) {
    return (
      <div className="req-headers">
        {toggle}
        <textarea
          className="req-headers-bulk"
          value={bulk}
          rows={Math.max(6, bulk.split('\n').length + 1)}
          spellCheck={false}
          placeholder={t('http.bulkPlaceholder')}
          aria-label={t('http.bulkEdit')}
          onChange={(e) => {
            setBulk(e.target.value);
            onChange(headersFromText(e.target.value));
          }}
        />
      </div>
    );
  }
  const update = (i: number, patch: Partial<HttpHeaderDraft>) => {
    const next = rows.map((h, j) => (j === i ? { ...h, ...patch } : h));
    const last = next[next.length - 1];
    onChange(last.name === '' && last.value === '' ? next.slice(0, -1) : next);
  };
  return (
    <div className="req-headers">
      {toggle}
      {authKind && (
        <div className="req-header-row req-header-auto" title={t('http.fromAuthTab')}>
          <input type="checkbox" checked disabled aria-label={t('http.headerEnabled')} />
          <input value="Authorization" readOnly disabled aria-label={t('http.headerName')} />
          <input value={`${authKind === 'basic' ? 'Basic' : 'Bearer'} ••••`} readOnly disabled aria-label={t('http.headerValue')} />
          <span className="muted">{t('http.fromAuthTab')}</span>
        </div>
      )}
      {rows.map((h, i) => {
        const isBlank = i === headers.length;
        return (
          <div key={i} className="req-header-row">
            <input type="checkbox" checked={h.enabled} disabled={isBlank} aria-label={t('http.headerEnabled')} onChange={(e) => update(i, { enabled: e.target.checked })} />
            <input value={h.name} placeholder={t('http.headerName')} spellCheck={false} aria-label={t('http.headerName')} onChange={(e) => update(i, { name: e.target.value })} />
            <VarInput value={h.value} placeholder={t('http.headerValue')} spellCheck={false} aria-label={t('http.headerValue')} variables={variables} onValueChange={(v) => update(i, { value: v })} />
            <button
              className="btn btn-ghost btn-sm btn-icon"
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

const BLANK_PARAM: QueryParam = { name: '', value: '' };

/** Rows of the URL query; the URL is the source of truth, so every edit rewrites it. */
function ParamsTab({ params, onChange, removeLabel = 'http.removeParam', max = Infinity, variables }: { params: QueryParam[]; onChange(p: QueryParam[]): void; removeLabel?: 'http.removeParam' | 'http.removeField'; max?: number; variables?: readonly RestEnvVar[] }) {
  const rows = params.length < max ? [...params, BLANK_PARAM] : params;
  const update = (i: number, patch: Partial<QueryParam>) => onChange(rows.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="req-headers">
      {rows.map((p, i) => {
        const isBlank = i === params.length;
        return (
          <div key={i} className="req-header-row req-param-row">
            <input value={p.name} placeholder={t('http.paramName')} spellCheck={false} aria-label={t('http.paramName')} onChange={(e) => update(i, { name: e.target.value })} />
            <VarInput value={p.value} placeholder={t('http.paramValue')} spellCheck={false} aria-label={t('http.paramValue')} variables={variables} onValueChange={(v) => update(i, { value: v })} />
            <button
              className="btn btn-ghost btn-sm btn-icon"
              disabled={isBlank}
              title={t(removeLabel)}
              aria-label={t(removeLabel)}
              onClick={() => onChange(params.filter((_, j) => j !== i))}
            >
              <Icon name="close" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function AuthTab({ value, onChange, auth, variables }: { value: HttpRequestDraft; onChange(patch: Partial<HttpRequestDraft>): void; auth: RequestAuthProps; variables?: readonly RestEnvVar[] }) {
  const parts = parseAuthValue(auth.value);
  const kind = value.authKind ?? parts.kind;
  const placeholder = auth.value === '' ? auth.placeholder : undefined;
  const setKind = (next: typeof kind) => {
    onChange({ authKind: next });
    if (auth.value !== '') auth.onChange('');
  };
  const edit = (patch: Partial<typeof parts>) => {
    if (!kind) return;
    if (value.authKind !== kind) onChange({ authKind: kind });
    auth.onChange(authHeaderValue(kind, { ...parts, ...patch }));
  };
  return (
    <div className="req-options req-auth">
      <div className="req-body-bar">
        {([undefined, 'basic', 'bearer'] as const).map((k) => (
          <button
            key={k ?? 'none'}
            className={`btn btn-sm${kind === k ? ' btn-primary' : ' btn-ghost'}`}
            aria-pressed={kind === k}
            disabled={auth.disabled}
            onClick={() => setKind(k)}
          >
            {t(`http.auth.${k ?? 'none'}`)}
          </button>
        ))}
      </div>
      {kind === 'basic' && (
        <>
          <label className="field">
            <span>{t('http.authUser')}</span>
            <VarInput value={parts.user} placeholder={placeholder} disabled={auth.disabled} spellCheck={false} autoComplete="off" variables={variables} onValueChange={(user) => edit({ user })} />
          </label>
          <label className="field">
            <span>{t('http.authPassword')}</span>
            <VarInput type="password" value={parts.password} placeholder={placeholder} disabled={auth.disabled} autoComplete="off" variables={variables} onValueChange={(password) => edit({ password })} />
          </label>
        </>
      )}
      {kind === 'bearer' && (
        <label className="field">
          <span>{t('http.authToken')}</span>
          <VarInput type="password" value={parts.token} placeholder={placeholder} disabled={auth.disabled} autoComplete="off" variables={variables} onValueChange={(token) => edit({ token })} />
        </label>
      )}
      {auth.hint && <span className="req-hint">{auth.hint}</span>}
      {hasAuthHeader(value.headers) && <span className="req-hint tone-warn">{t('http.authOverridden')}</span>}
    </div>
  );
}

function BodyTab({ value, onChange, onSend, variables }: { value: HttpRequestDraft; onChange(patch: Partial<HttpRequestDraft>): void; onSend(): void; variables?: readonly RestEnvVar[] }) {
  const [formatError, setFormatError] = useState<string | null>(null);
  const highlight = useMemo(() => (variables ? [variableHighlight(variables), variableAutocomplete(variables)] : []), [variables]);
  const bodyless = !sendsBody(value.method);
  const format = () => {
    try {
      onChange({ body: value.bodyLang === 'xml' ? formatXml(value.body) : JSON.stringify(JSON.parse(value.body), null, 2) });
      setFormatError(null);
    } catch (err) {
      setFormatError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="req-body">
      <div className="req-body-bar">
        {(['json', 'xml', 'text', 'form', 'multipart'] as const).map((lang) => (
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
        {(value.bodyLang === 'json' || value.bodyLang === 'xml') && (
          <button className="btn btn-ghost btn-sm" onClick={format} disabled={value.body.trim() === ''}>{t('http.format')}</button>
        )}
      </div>
      {formatError && <span className="field-error">{t(value.bodyLang === 'xml' ? 'preview.xmlError' : 'preview.jsonError', { message: formatError })}</span>}
      {bodyless && <span className="req-hint">{t('http.bodyIgnored', { method: value.method })}</span>}
      {value.bodyLang === 'form' || value.bodyLang === 'multipart' ? (
        <div className={bodyless ? 'req-body-form disabled' : 'req-body-form'}>
          {value.bodyLang === 'multipart' && <span className="req-hint">{t('http.multipartTextOnly')}</span>}
          <ParamsTab params={value.form ?? []} onChange={(form) => onChange({ form })} removeLabel="http.removeField" max={HTTP_MAX_FORM_FIELDS} variables={variables} />
        </div>
      ) : (
        <div className={bodyless ? 'req-body-editor disabled' : 'req-body-editor'}>
          <CodeEditor
            value={value.body}
            lang={value.bodyLang}
            placeholder={t('http.bodyPlaceholder')}
            extensions={highlight}
            onChange={(body) => {
              setFormatError(null);
              onChange({ body });
            }}
            onRun={onSend}
          />
        </div>
      )}
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
          min={HTTP_TIMEOUT_MIN_MS / 1000}
          max={HTTP_TIMEOUT_MAX_MS / 1000}
          value={seconds}
          placeholder="60"
          onChange={(e) => onChange({ timeoutMs: timeoutFromSeconds(e.target.value) })}
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
