import { AppError } from '@kedalion/server-core';

export type SourceErrorCode = 'not-configured' | 'auth' | 'rate-limited' | 'offline' | 'upstream' | 'tool-missing';

const KIND = {
  'not-configured': 'invalid',
  auth: 'forbidden',
  'rate-limited': 'internal',
  offline: 'internal',
  upstream: 'internal',
  'tool-missing': 'invalid',
} as const;

/** An `AppError` with code `source-<code>`; the web translates `error.source-<code>`. */
export function SourceError(code: SourceErrorCode, message: string, detail?: string, params?: Record<string, string | number>): AppError {
  return new AppError(KIND[code], `source-${code}`, message, { detail, params });
}

/** The code of a non-2xx answer: 401/403 `auth`, 429 or an exhausted GitHub quota `rate-limited`, else `upstream`. */
export function codeForStatus(status: number, headers: Pick<Headers, 'get'>): SourceErrorCode {
  if (status === 429 || headers.get('x-ratelimit-remaining') === '0') return 'rate-limited';
  if (status === 401 || status === 403) return 'auth';
  return 'upstream';
}

/**
 * `fetch` for a data source: a network failure becomes `offline`, a non-2xx answer the code of
 * `codeForStatus`. The caller reads the body of the returned (ok) response.
 */
export async function sourceFetch(url: string, init: RequestInit = {}, ctx: { signal?: AbortSignal } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: init.signal ?? ctx.signal });
  } catch (err) {
    if (ctx.signal?.aborted || init.signal?.aborted) throw err;
    throw SourceError('offline', 'The service is not reachable.', String((err as Error)?.message ?? err));
  }
  if (!res.ok) throw SourceError(codeForStatus(res.status, res.headers), `The service answered ${res.status}.`, `${res.status} ${res.statusText}`.trim());
  return res;
}

/** True when the response declares a `content-length` above `maxBytes`. */
export const declaredTooLarge = (res: Response, maxBytes: number): boolean => Number(res.headers.get('content-length') ?? 0) > maxBytes;

/**
 * The body as UTF-8 text, read in chunks and stopped at `maxBytes` (the rest is cancelled).
 * `truncated` is true when the body had more than `maxBytes`.
 */
export async function readLimited(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder().decode(all), truncated };
}
