import {
  HTTP_TIMEOUT_MAX_MS,
  HTTP_TIMEOUT_MIN_MS,
  type HttpMethod,
  type HttpRequestDraft,
  type HttpRequestSpec,
  type HttpResponseInfo,
} from '@deckbuilder/server-core/protocol';
import type { Lang } from './languages';

export type { HttpHeaderDraft, HttpRequestDraft } from '@deckbuilder/server-core/protocol';

/** The timeout field's text (seconds) as whole-second milliseconds within the protocol bounds; undefined for empty or not a number. */
export function timeoutFromSeconds(text: string): number | undefined {
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n)) return undefined;
  return Math.min(HTTP_TIMEOUT_MAX_MS, Math.max(HTTP_TIMEOUT_MIN_MS, Math.round(n) * 1000));
}

export const emptyDraft = (): HttpRequestDraft => ({ method: 'GET', url: '', headers: [], body: '', bodyLang: 'json' });

/** GET and HEAD requests carry no body. */
export const sendsBody = (method: HttpMethod): boolean => method !== 'GET' && method !== 'HEAD';

export function draftToSpec(draft: HttpRequestDraft): HttpRequestSpec {
  const headers: Array<[string, string]> = draft.headers
    .filter((h) => h.enabled && h.name.trim() !== '')
    .map((h) => [h.name.trim(), h.value]);
  const spec: HttpRequestSpec = { method: draft.method, url: draft.url, headers };
  if (sendsBody(draft.method) && draft.body !== '') {
    spec.body = draft.body;
    if (draft.bodyLang === 'json' && !headers.some(([name]) => name.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', 'application/json']);
    }
  }
  if (draft.timeoutMs !== undefined) spec.timeoutMs = draft.timeoutMs;
  if (draft.insecure !== undefined) spec.insecure = draft.insecure;
  if (draft.followRedirects !== undefined) spec.followRedirects = draft.followRedirects;
  return spec;
}

export function statusTone(status: number): 'ok' | 'info' | 'warn' | 'err' {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'info';
  if (status >= 400 && status < 500) return 'warn';
  return 'err';
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = n;
  let i = -1;
  do {
    value /= 1000;
    i++;
  } while (value >= 1000 && i < units.length - 1);
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`;
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
