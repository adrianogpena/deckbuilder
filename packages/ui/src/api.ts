import { CODE_PARAM, SESSION_PATH, TOKEN_HEADER } from '@deckbuilderkit/server-core/protocol';
import { type QueryParams, qs, RequestError } from './api-core';
import { t } from './i18n';

export { type ApiError, errorMessage, errorOf, type QueryParams, qs, RequestError } from './api-core';

const TOKEN_KEY = 'deckbuilder.token';

const offline = () => new RequestError({ kind: 'offline', code: 'offline', message: t('error.offline') });

// Launch URLs carry a one-time code (?c=...); it is hidden from the address bar at once, then
// traded for the session token, which stays in this window's sessionStorage.
function takeCode(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(CODE_PARAM);
  if (code === null) return null;
  url.searchParams.delete(CODE_PARAM);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return code;
}

async function openSession(code: string | null): Promise<string> {
  if (code === null) {
    try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
  }
  let res: Response;
  try {
    res = await fetch(SESSION_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  } catch {
    throw offline();
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new RequestError(data ?? { kind: 'forbidden', code: 'invalidCode', message: 'This link was already used or has expired. Open the app again.' });
  }
  const token = String(data?.token ?? '');
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* storage may be blocked */ }
  return token;
}

/**
 * The session token: '' when the URL had no code and none was stored. Rejects with RequestError
 * `invalidCode` when the code was used or expired, `offline` when the server can't be reached.
 */
export const session: Promise<string> = openSession(takeCode());
// request() rethrows the rejection; this keeps an unused session from logging an unhandled one.
session.catch(() => {});

/** True inside the app's native window (set by the shell's init script), false in a browser. */
export const isDesktop = (window as { __DECKBUILDER_SHELL__?: string }).__DECKBUILDER_SHELL__ === 'window';

/**
 * Calls the app server with the session token; throws RequestError with the server's ApiError.
 * An aborted `opts.signal` rethrows the `AbortError` (not an offline error), so callers can ignore it.
 */
export async function request<T>(method: string, path: string, params: QueryParams = {}, body?: unknown, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const token = await session;
  let res: Response;
  try {
    res = await fetch(path + qs(params), {
      method,
      headers: { [TOKEN_HEADER]: token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw offline();
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RequestError(data ?? { kind: 'internal', code: 'http', params: { status: res.status }, message: `HTTP error ${res.status}` });
  return data as T;
}

/**
 * GETs non-JSON bytes (e.g. `/api/fs/raw`) with the session token header; throws RequestError
 * like `request`. For an `<img>`, wrap the blob with `URL.createObjectURL` (and revoke it).
 */
export async function requestBlob(path: string, params: QueryParams = {}): Promise<Blob> {
  const token = await session;
  let res: Response;
  try {
    res = await fetch(path + qs(params), { headers: { [TOKEN_HEADER]: token } });
  } catch {
    throw offline();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new RequestError(data ?? { kind: 'internal', code: 'http', params: { status: res.status }, message: `HTTP error ${res.status}` });
  }
  return res.blob();
}

/** POSTs `body` (a file's bytes) as the request body with the session token header; throws RequestError like `request`. */
export async function requestUpload<T>(path: string, params: QueryParams, body: Blob): Promise<T> {
  const token = await session;
  let res: Response;
  try {
    res = await fetch(path + qs(params), { method: 'POST', headers: { [TOKEN_HEADER]: token, 'Content-Type': 'application/octet-stream' }, body });
  } catch {
    throw offline();
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RequestError(data ?? { kind: 'internal', code: 'http', params: { status: res.status }, message: `HTTP error ${res.status}` });
  return data as T;
}

export interface DialogFilter {
  name: string;
  /** Globs such as `*.md`. */
  patterns: string[];
}

const dialog = (kind: string, opts: object) => request<{ path: string | null }>('POST', `/api/dialog/${kind}`, {}, opts).then((r) => r.path);

/**
 * Native dialogs through the app server's `dialogRoutes`; each resolves an absolute path, or null
 * when cancelled. Only one dialog is open at a time (`error.dialogBusy`).
 */
export const dialogs = {
  pickFolder: (opts: { title?: string } = {}) => dialog('folder', opts),
  pickFile: (opts: { title?: string; filters?: DialogFilter[] } = {}) => dialog('file', opts),
  saveFileAs: (opts: { title?: string; suggestedName?: string; filters?: DialogFilter[] } = {}) => dialog('save', opts),
};
