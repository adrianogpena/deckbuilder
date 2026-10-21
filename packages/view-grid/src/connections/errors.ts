import { AppError } from '@deckbuilderkit/server-core';

export type SourceErrorCode = 'not-configured' | 'auth' | 'rate-limited' | 'offline' | 'upstream';

const KIND = {
  'not-configured': 'invalid',
  auth: 'forbidden',
  'rate-limited': 'internal',
  offline: 'internal',
  upstream: 'internal',
} as const;

/** An `AppError` with code `source-<code>`; the web translates `error.source-<code>`. */
export function SourceError(code: SourceErrorCode, message: string, detail?: string): AppError {
  return new AppError(KIND[code], `source-${code}`, message, { detail });
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
