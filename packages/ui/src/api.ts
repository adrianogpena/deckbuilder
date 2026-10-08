import { type ApiErrorBody, CODE_PARAM, SESSION_PATH, TOKEN_HEADER } from '@deckbuilder/server-core/protocol';
import { t, tryT } from './i18n';

export type ApiError = ApiErrorBody;

/** Translated, user-facing text for an API error. */
export function errorMessage(err: ApiError): string {
  return (err.code && err.code !== 'raw' ? tryT(`error.${err.code}`, err.params) : undefined) ?? err.message;
}

export class RequestError extends Error {
  constructor(readonly info: ApiError) {
    super(info.message);
  }
}

export function errorOf(err: unknown): ApiError {
  if (err instanceof RequestError) return err.info;
  return { kind: 'internal', code: 'raw', message: String((err as Error)?.message ?? err) };
}

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

export type QueryParams = Record<string, string | number | boolean | undefined>;

function qs(params: QueryParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Calls the app server with the session token; throws RequestError with the server's ApiError. */
export async function request<T>(method: string, path: string, params: QueryParams = {}, body?: unknown): Promise<T> {
  const token = await session;
  let res: Response;
  try {
    res = await fetch(path + qs(params), {
      method,
      headers: { [TOKEN_HEADER]: token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw offline();
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RequestError(data ?? { kind: 'internal', code: 'http', params: { status: res.status }, message: `HTTP error ${res.status}` });
  return data as T;
}
