import {
  HTTP_TIMEOUT_MAX_MS,
  HTTP_TIMEOUT_MIN_MS,
  type HttpAuthKind,
  type HttpMethod,
  type HttpRequestDraft,
  type HttpRequestSpec,
  type HttpResponseInfo,
} from '@deckbuilder/server-core/protocol';
import type { Lang } from './languages';

import type { HttpHeaderDraft } from '@deckbuilder/server-core/protocol';

export type { HttpHeaderDraft, HttpRequestDraft } from '@deckbuilder/server-core/protocol';

/** The timeout field's text (seconds) as whole-second milliseconds within the protocol bounds; undefined for empty or not a number. */
export function timeoutFromSeconds(text: string): number | undefined {
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n)) return undefined;
  return Math.min(HTTP_TIMEOUT_MAX_MS, Math.max(HTTP_TIMEOUT_MIN_MS, Math.round(n) * 1000));
}

/** Headers as "Name: Value" lines; disabled ones are prefixed with "// ". */
export function headersToText(headers: HttpHeaderDraft[]): string {
  return headers.map((h) => `${h.enabled ? '' : '// '}${h.name}: ${h.value}`).join('\n');
}

export function headersFromText(text: string): HttpHeaderDraft[] {
  const headers: HttpHeaderDraft[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    const enabled = !line.startsWith('//');
    if (!enabled) line = line.slice(2).trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    headers.push(
      colon < 0
        ? { name: line, value: '', enabled }
        : { name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim(), enabled },
    );
  }
  return headers;
}

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![\s\S]*?>|<\/?[A-Za-z_][^>]*>|[^<]+|</g;

/**
 * Re-indents XML with two spaces. Text-only elements stay on one line and whitespace-only text between
 * tags is dropped; throws on unbalanced tags. Text nodes are trimmed, which is fine for data but not for mixed content.
 */
export function formatXml(source: string): string {
  const tokens = source.match(XML_TOKEN) ?? [];
  const lines: string[] = [];
  const open: string[] = [];
  const nameOf = (tag: string) => /^<\/?([^\s/>]+)/.exec(tag)![1];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const pad = '  '.repeat(open.length);
    if (tok === '<') throw new Error('Unexpected "<"');
    if (!tok.startsWith('<')) {
      const text = tok.trim();
      if (text) lines.push(pad + text);
    } else if (tok.startsWith('</')) {
      const name = nameOf(tok);
      if (open.pop() !== name) throw new Error(`Unexpected closing tag </${name}>`);
      lines.push('  '.repeat(open.length) + tok);
    } else if (/^<[A-Za-z_]/.test(tok) && !tok.endsWith('/>')) {
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      if (next !== undefined && !next.startsWith('<') && after?.startsWith('</') && nameOf(after) === nameOf(tok)) {
        lines.push(pad + tok + next.trim() + after);
        i += 2;
      } else {
        open.push(nameOf(tok));
        lines.push(pad + tok);
      }
    } else {
      lines.push(pad + tok);
    }
  }
  if (open.length) throw new Error(`Unclosed tag <${open[open.length - 1]}>`);
  return lines.join('\n');
}

export interface QueryParam {
  name: string;
  value: string;
}

/** The URL split at the query: text before `?`, the raw query (undefined without `?`) and the `#fragment`. */
function splitQuery(url: string): { base: string; query?: string; hash: string } {
  const h = url.indexOf('#');
  const hash = h < 0 ? '' : url.slice(h);
  const rest = h < 0 ? url : url.slice(0, h);
  const q = rest.indexOf('?');
  return q < 0 ? { base: rest, hash } : { base: rest.slice(0, q), query: rest.slice(q + 1), hash };
}

/** The query of `url` as raw (not decoded) name/value pairs; empty segments are skipped. */
export function queryParams(url: string): QueryParam[] {
  const { query } = splitQuery(url);
  if (!query) return [];
  return query
    .split('&')
    .filter((s) => s !== '')
    .map((s) => {
      const eq = s.indexOf('=');
      return eq < 0 ? { name: s, value: '' } : { name: s.slice(0, eq), value: s.slice(eq + 1) };
    });
}

const escapeQueryPart = (s: string, isName: boolean) =>
  s.replace(isName ? /[&#=]/g : /[&#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** `url` with its query replaced by `params`; everything else (scheme-less, `{{vars}}`, fragment) stays as typed. */
export function withQueryParams(url: string, params: QueryParam[]): string {
  const { base, hash } = splitQuery(url);
  const query = params
    .filter((p) => p.name !== '' || p.value !== '')
    .map((p) => escapeQueryPart(p.name, true) + (p.value === '' ? '' : `=${escapeQueryPart(p.value, false)}`))
    .join('&');
  return query === '' ? base + hash : `${base}?${query}${hash}`;
}

export interface AuthParts {
  kind?: HttpAuthKind;
  user: string;
  password: string;
  token: string;
}

const toBase64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(''));

function fromBase64(s: string): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

/** The Authorization header value for `kind`: `Basic base64(user:password)` or `Bearer token`; '' when the fields are empty. */
export function authHeaderValue(kind: HttpAuthKind, parts: Pick<AuthParts, 'user' | 'password' | 'token'>): string {
  if (kind === 'bearer') return parts.token.trim() === '' ? '' : `Bearer ${parts.token.trim()}`;
  return parts.user === '' && parts.password === '' ? '' : `Basic ${toBase64(`${parts.user}:${parts.password}`)}`;
}

/** Splits an Authorization value back into the Auth tab's fields; `kind` is undefined when it is neither Basic nor Bearer. */
export function parseAuthValue(value: string): AuthParts {
  const empty = { user: '', password: '', token: '' };
  const m = /^(\w+)\s+(.*)$/s.exec(value.trim());
  if (!m) return empty;
  const scheme = m[1].toLowerCase();
  if (scheme === 'bearer') return { ...empty, kind: 'bearer', token: m[2] };
  if (scheme !== 'basic') return empty;
  const decoded = fromBase64(m[2].trim());
  if (decoded === undefined) return { ...empty, kind: 'basic' };
  const colon = decoded.indexOf(':');
  return colon < 0
    ? { ...empty, kind: 'basic', user: decoded }
    : { ...empty, kind: 'basic', user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/** True when an enabled header named Authorization (any case) is set by hand; it wins over the Auth tab. */
export const hasAuthHeader = (headers: HttpHeaderDraft[]): boolean =>
  headers.some((h) => h.enabled && h.name.trim().toLowerCase() === 'authorization');

export const emptyDraft =(): HttpRequestDraft => ({ method: 'GET', url: '', headers: [], body: '', bodyLang: 'json' });

/** GET and HEAD requests carry no body. */
export const sendsBody = (method: HttpMethod): boolean => method !== 'GET' && method !== 'HEAD';

export function draftToSpec(draft: HttpRequestDraft): HttpRequestSpec {
  const headers: Array<[string, string]> = draft.headers
    .filter((h) => h.enabled && h.name.trim() !== '')
    .map((h) => [h.name.trim(), h.value]);
  const spec: HttpRequestSpec = { method: draft.method, url: draft.url, headers };
  if (draft.bodyLang === 'form' || draft.bodyLang === 'multipart') {
    const form = (draft.form ?? []).filter((f) => f.name.trim() !== '').map((f): [string, string] => [f.name.trim(), f.value]);
    if (sendsBody(draft.method) && form.length) {
      spec.bodyKind = draft.bodyLang;
      spec.form = form;
    }
  } else if (sendsBody(draft.method) && draft.body !== '') {
    spec.body = draft.body;
    if (draft.bodyLang !== 'text' && !headers.some(([name]) => name.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', draft.bodyLang === 'xml' ? 'application/xml' : 'application/json']);
    }
  }
  if (draft.timeoutMs !== undefined) spec.timeoutMs = draft.timeoutMs;
  if (draft.insecure !== undefined) spec.insecure = draft.insecure;
  if (draft.followRedirects !== undefined) spec.followRedirects = draft.followRedirects;
  return spec;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The request as a multi-line cURL command for a POSIX shell. `auth` is the Authorization value
 * from the Auth tab (Basic → `-u user:pass`, otherwise a header); an Authorization header in the
 * spec wins over it. Form rows become `--data-urlencode 'n=v'`, multipart rows `-F 'n=v'`
 * (`--form-string` when the value starts with `@`/`<` or holds `;`, which `-F` would read as a file or part option).
 */
export function toCurl(spec: HttpRequestSpec, auth?: string): string {
  const parts = [`curl ${shq(spec.url)}`];
  const form = spec.bodyKind && spec.form?.length ? spec.form : undefined;
  const bodyless = spec.method === 'GET' && spec.body === undefined && !form;
  if (!bodyless) parts.push(`-X ${spec.method}`);
  if (spec.followRedirects !== false) parts.push('-L');
  if (spec.insecure) parts.push('--insecure');
  if (spec.timeoutMs !== undefined) parts.push(`--max-time ${Math.round(spec.timeoutMs / 1000)}`);
  if (auth && !spec.headers.some(([name]) => name.toLowerCase() === 'authorization')) {
    const parsed = parseAuthValue(auth);
    const basic = parsed.kind === 'basic' && authHeaderValue('basic', parsed) === auth.trim();
    parts.push(basic ? `-u ${shq(`${parsed.user}:${parsed.password}`)}` : `-H ${shq(`Authorization: ${auth.trim()}`)}`);
  }
  for (const [name, value] of spec.headers) parts.push(`-H ${shq(`${name}: ${value}`)}`);
  if (form && spec.bodyKind === 'form') for (const [name, value] of form) parts.push(`--data-urlencode ${shq(`${name}=${value}`)}`);
  else if (form) for (const [name, value] of form) parts.push(`${/^[@<]|;/.test(value) ? '--form-string' : '-F'} ${shq(`${name}=${value}`)}`);
  else if (spec.body !== undefined) parts.push(`--data-raw ${shq(spec.body)}`);
  return parts.join(' \\\n  ');
}

export function statusTone(status: number): 'ok' | 'info' | 'warn' | 'err' {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'info';
  if (status >= 400 && status < 500) return 'warn';
  return 'err';
}

export function formatMs(n: number): string {
  if (n < 1000) return `${Math.round(n)} ms`;
  const s = n / 1000;
  return `${s >= 10 ? Math.round(s) : Math.round(s * 10) / 10} s`;
}

export type BodyView =
  | { kind: 'json'; value: unknown; pretty: string }
  | { kind: 'text'; lang: Lang; text: string }
  | { kind: 'binary' };

export function bodyView(info: Pick<HttpResponseInfo, 'binary' | 'text' | 'contentType'>): BodyView {
  if (info.binary || info.text === undefined) return { kind: 'binary' };
  try {
    const value: unknown = JSON.parse(info.text);
    return { kind: 'json', value, pretty: JSON.stringify(value, null, 2) };
  } catch {
    const markdown = info.contentType.split(';')[0].trim().toLowerCase() === 'text/markdown';
    return { kind: 'text', lang: markdown ? 'markdown' : 'text', text: info.text };
  }
}
