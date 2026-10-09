import {
  HTTP_TIMEOUT_MAX_MS,
  HTTP_TIMEOUT_MIN_MS,
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

export const emptyDraft =(): HttpRequestDraft => ({ method: 'GET', url: '', headers: [], body: '', bodyLang: 'json' });

/** GET and HEAD requests carry no body. */
export const sendsBody = (method: HttpMethod): boolean => method !== 'GET' && method !== 'HEAD';

export function draftToSpec(draft: HttpRequestDraft): HttpRequestSpec {
  const headers: Array<[string, string]> = draft.headers
    .filter((h) => h.enabled && h.name.trim() !== '')
    .map((h) => [h.name.trim(), h.value]);
  const spec: HttpRequestSpec = { method: draft.method, url: draft.url, headers };
  if (sendsBody(draft.method) && draft.body !== '') {
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

/** The request as a multi-line cURL command for a POSIX shell. */
export function toCurl(spec: HttpRequestSpec): string {
  const parts = [`curl ${shq(spec.url)}`];
  const bodyless = spec.method === 'GET' && spec.body === undefined;
  if (!bodyless) parts.push(`-X ${spec.method}`);
  if (spec.followRedirects !== false) parts.push('-L');
  if (spec.insecure) parts.push('--insecure');
  if (spec.timeoutMs !== undefined) parts.push(`--max-time ${Math.round(spec.timeoutMs / 1000)}`);
  for (const [name, value] of spec.headers) parts.push(`-H ${shq(`${name}: ${value}`)}`);
  if (spec.body !== undefined) parts.push(`--data-raw ${shq(spec.body)}`);
  return parts.join(' \\\n  ');
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
