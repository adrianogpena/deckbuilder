import { extname } from 'node:path';
import { saveFileAs, writeFileAtomic } from '@deckbuilder/platform';
import { AppError, invalid, isRecord, type Routes } from '@deckbuilder/server-core';
import {
  HTTP_MAX_BODY_BYTES,
  HTTP_MAX_BODY_CHARS,
  HTTP_MAX_FORM_FIELDS,
  HTTP_MAX_HEADERS,
  HTTP_MAX_URL_CHARS,
  HTTP_METHODS,
  HTTP_TIMEOUT_MAX_MS,
  HTTP_TIMEOUT_MIN_MS,
  type HttpMethod,
  type HttpRequestDraft,
  type HttpRequestSpec,
  type HttpResponseInfo,
} from '@deckbuilder/server-core/protocol';
import { isBinary } from './bytes.ts';
import { fromPlatform } from './platform-errors.ts';

export interface HttpExecutorOptions {
  /** Most body bytes read; the rest is cut and the response is marked `truncated`. */
  maxBodyBytes?: number;
  /** How many response bodies stay available to `body`/save; the oldest is dropped. */
  keep?: number;
  fetchImpl?: typeof fetch;
}

export interface KeptBody {
  bytes: Uint8Array;
  contentType: string;
  /** The final URL. */
  url: string;
}

export interface HttpExecutor {
  send(spec: HttpRequestSpec, signal?: AbortSignal): Promise<HttpResponseInfo>;
  body(id: string): KeptBody | undefined;
}

export interface HttpRoutesOptions {
  /** Headers to add for a saved request's secret, for names the request doesn't have; the values never reach the client. */
  secretHeaders?: (ref: string, url: string) => Promise<Array<[string, string]>>;
  save?: typeof saveFileAs;
}

const MAX_HEADER_NAME_CHARS = 200;
const MAX_HEADER_VALUE_CHARS = 8192;
const DEFAULT_TIMEOUT_MS = 60_000;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE_BAD = /[\r\n\0]/;

const badRequest = () => invalid('badRequest', 'Invalid request.');
const formChars = (rows: Array<{ name: string; value: string }>) => rows.reduce((n, r) => n + r.name.length + r.value.length, 0);
const validTimeout = (ms: unknown): ms is number => typeof ms === 'number' && Number.isInteger(ms) && ms >= HTTP_TIMEOUT_MIN_MS && ms <= HTTP_TIMEOUT_MAX_MS;

/** The request as a fresh, fully defaulted spec; throws an `invalid` AppError for anything out of range (never clamps). */
export function validateRequest(input: unknown): HttpRequestSpec {
  if (!isRecord(input)) throw badRequest();
  const { method, url, headers = [], body, bodyKind, form, timeoutMs = DEFAULT_TIMEOUT_MS, insecure = false, followRedirects = true } = input;
  if (typeof method !== 'string') throw badRequest();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) throw invalid('badMethod', 'This HTTP method is not supported.');
  if (typeof url !== 'string') throw badRequest();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid('badUrl', 'Enter a valid http:// or https:// URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw invalid('badUrl', 'Enter a valid http:// or https:// URL.');
  if (!Array.isArray(headers)) throw badRequest();
  const pairs: Array<[string, string]> = headers.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') throw badRequest();
    return [pair[0], pair[1]];
  });
  if (pairs.length > HTTP_MAX_HEADERS || pairs.some(([name, value]) => !HEADER_NAME.test(name) || HEADER_VALUE_BAD.test(value))) {
    throw invalid('badHeader', 'A header name or value is not valid.');
  }
  if (body !== undefined && (typeof body !== 'string' || body.length > HTTP_MAX_BODY_CHARS)) throw badRequest();
  let fields: Array<[string, string]> = [];
  if (bodyKind !== undefined) {
    if ((bodyKind !== 'form' && bodyKind !== 'multipart') || body !== undefined || !Array.isArray(form) || form.length > HTTP_MAX_FORM_FIELDS) throw badRequest();
    fields = form.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') throw badRequest();
      return [pair[0], pair[1]];
    });
    if (formChars(fields.map(([name, value]) => ({ name, value }))) > HTTP_MAX_BODY_CHARS) throw badRequest();
  } else if (form !== undefined) throw badRequest();
  if ((body || fields.length) && (method === 'GET' || method === 'HEAD')) throw invalid('bodyNotAllowed', 'GET and HEAD requests cannot have a body.');
  if (!validTimeout(timeoutMs)) throw badRequest();
  if (typeof insecure !== 'boolean' || typeof followRedirects !== 'boolean') throw badRequest();
  const spec: HttpRequestSpec = { method: method as HttpMethod, url, headers: pairs, timeoutMs, insecure, followRedirects };
  if (body) spec.body = body;
  if (fields.length) {
    spec.bodyKind = bodyKind as 'form' | 'multipart';
    spec.form = fields;
  }
  return spec;
}

const BODY_LANGS = ['json', 'xml', 'text', 'form', 'multipart'] as const;
const badSavedRequest = () => invalid('badSavedRequest', 'The request is not valid.');

/**
 * A saved request draft as a fresh object; throws `badSavedRequest` for anything out of range.
 * Looser than `validateRequest` (an empty or unfinished URL can be saved), but within its limits.
 */
export function validateDraft(raw: unknown): HttpRequestDraft {
  if (!isRecord(raw)) throw badSavedRequest();
  const { method, url, headers, body, bodyLang, form, authKind, timeoutMs, insecure, followRedirects } = raw;
  if (!(HTTP_METHODS as readonly unknown[]).includes(method)) throw badSavedRequest();
  if (typeof url !== 'string' || url.length > HTTP_MAX_URL_CHARS) throw badSavedRequest();
  if (!Array.isArray(headers) || headers.length > HTTP_MAX_HEADERS) throw badSavedRequest();
  if (typeof body !== 'string' || body.length > HTTP_MAX_BODY_CHARS) throw badSavedRequest();
  if (!(BODY_LANGS as readonly unknown[]).includes(bodyLang)) throw badSavedRequest();
  const out: HttpRequestDraft = {
    method: method as HttpMethod,
    url,
    headers: headers.map((h) => {
      if (
        !isRecord(h) ||
        typeof h.name !== 'string' ||
        h.name.length > MAX_HEADER_NAME_CHARS ||
        typeof h.value !== 'string' ||
        h.value.length > MAX_HEADER_VALUE_CHARS ||
        typeof h.enabled !== 'boolean'
      ) {
        throw badSavedRequest();
      }
      return { name: h.name, value: h.value, enabled: h.enabled };
    }),
    body,
    bodyLang: bodyLang as HttpRequestDraft['bodyLang'],
  };
  if (form !== undefined) {
    if (!Array.isArray(form) || form.length > HTTP_MAX_FORM_FIELDS) throw badSavedRequest();
    out.form = form.map((f) => {
      if (!isRecord(f) || typeof f.name !== 'string' || typeof f.value !== 'string') throw badSavedRequest();
      return { name: f.name, value: f.value };
    });
    if (formChars(out.form) > HTTP_MAX_BODY_CHARS) throw badSavedRequest();
  }
  if (authKind !== undefined) {
    if (authKind !== 'basic' && authKind !== 'bearer') throw badSavedRequest();
    out.authKind = authKind;
  }
  if (timeoutMs !== undefined) {
    if (!validTimeout(timeoutMs)) throw badSavedRequest();
    out.timeoutMs = timeoutMs;
  }
  if (insecure !== undefined) {
    if (typeof insecure !== 'boolean') throw badSavedRequest();
    out.insecure = insecure;
  }
  if (followRedirects !== undefined) {
    if (typeof followRedirects !== 'boolean') throw badSavedRequest();
    out.followRedirects = followRedirects;
  }
  return out;
}

const isTextType = (contentType: string) => {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  return (
    type === '' ||
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type === 'application/x-www-form-urlencoded'
  );
};

/**
 * The HTTP engine of the base: sends a validated request from the server (no CORS, and the
 * session token never leaves) and keeps the last `keep` response bodies for saving.
 */
export function httpExecutor(opts: HttpExecutorOptions = {}): HttpExecutor {
  const { maxBodyBytes = HTTP_MAX_BODY_BYTES, keep = 10, fetchImpl = fetch } = opts;
  const kept = new Map<string, KeptBody>();

  async function read(res: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBodyBytes - total;
      if (value.length > room) {
        chunks.push(value.subarray(0, room));
        total += room;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.length;
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { bytes, truncated };
  }

  return {
    async send(spec, signal) {
      const timeout = AbortSignal.timeout(spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const started = performance.now();
      let headers = spec.headers;
      let body: string | URLSearchParams | FormData | undefined = spec.body;
      if (spec.bodyKind && spec.form) {
        if (spec.bodyKind === 'multipart') {
          const data = new FormData();
          for (const [name, value] of spec.form) data.append(name, value);
          body = data;
          headers = headers.filter(([name]) => name.toLowerCase() !== 'content-type');
        } else {
          body = new URLSearchParams(spec.form);
          if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) {
            headers = [...headers, ['Content-Type', 'application/x-www-form-urlencoded']];
          }
        }
      }
      try {
        const res = await fetchImpl(spec.url, {
          method: spec.method,
          headers,
          body,
          redirect: spec.followRedirects === false ? 'manual' : 'follow',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          tls: { rejectUnauthorized: !spec.insecure },
        });
        const ms = Math.round(performance.now() - started);
        const { bytes, truncated } = await read(res);
        const totalMs = Math.round(performance.now() - started);
        const contentType = res.headers.get('content-type') ?? '';
        const id = crypto.randomUUID();
        kept.set(id, { bytes, contentType, url: res.url });
        while (kept.size > keep) kept.delete(kept.keys().next().value as string);
        const info: HttpResponseInfo = {
          id,
          status: res.status,
          statusText: res.statusText,
          url: res.url,
          redirected: res.redirected,
          headers: [...res.headers],
          ms,
          totalMs,
          size: bytes.length,
          truncated,
          contentType,
        };
        if (isTextType(contentType) && !isBinary(bytes)) info.text = new TextDecoder().decode(bytes);
        else info.binary = true;
        return info;
      } catch (err) {
        if (signal?.aborted) throw err;
        if (timeout.aborted) throw invalid('httpTimeout', 'The request timed out.');
        if (err instanceof AppError) throw err;
        throw new AppError('invalid', 'httpFailed', 'The request failed.', { detail: err instanceof Error ? err.message : String(err) });
      }
    },
    body: (id) => kept.get(id),
  };
}

const EXTENSIONS: Array<[string, string]> = [
  ['json', '.json'],
  ['html', '.html'],
  ['xml', '.xml'],
  ['text/', '.txt'],
];

/** A file name for a saved response: the last segment of the URL path, made safe, with an extension from the content type when it has none. */
export function suggestedName(url: string, contentType: string): string {
  let name = new URL(url).pathname.split('/').pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not valid percent-encoding: keep the name as it is.
  }
  name = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 100)
    .replace(/[. ]+$/, '');
  if (name === '') name = 'response';
  if (extname(name) === '') {
    const type = contentType.toLowerCase();
    name += EXTENSIONS.find(([part]) => type.includes(part))?.[1] ?? '';
  }
  return name;
}

/** `POST /api/http/send` (`{ request, secretRef? }`) and `POST /api/http/save` (`{ id }`, asks for the target in a server-side dialog). */
export function httpRoutes(executor: HttpExecutor, opts: HttpRoutesOptions = {}): Routes {
  const { secretHeaders, save = saveFileAs } = opts;
  return {
    'POST /api/http/send': async ({ req, json }) => {
      const body = await json();
      if (!isRecord(body)) throw badRequest();
      const spec = validateRequest(body.request);
      if (typeof body.secretRef === 'string' && secretHeaders) {
        const have = new Set(spec.headers.map(([name]) => name.toLowerCase()));
        for (const [name, value] of await secretHeaders(body.secretRef, spec.url)) {
          if (have.has(name.toLowerCase())) continue;
          have.add(name.toLowerCase());
          spec.headers.push([name, value]);
        }
      }
      return executor.send(spec, req.signal);
    },

    'POST /api/http/save': async ({ json }) => {
      const body = await json();
      if (!isRecord(body) || typeof body.id !== 'string') throw badRequest();
      const response = executor.body(body.id);
      if (!response) throw invalid('responseGone', 'This response is no longer kept; send the request again.');
      const path = await save({ suggestedName: suggestedName(response.url, response.contentType) }).catch(fromPlatform);
      if (path === null) return { path: null };
      await writeFileAtomic(path, response.bytes);
      return { path, bytes: response.bytes.length };
    },
  };
}
