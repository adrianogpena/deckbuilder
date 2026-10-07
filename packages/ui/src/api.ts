import { type ApiErrorBody, TOKEN_HEADER, TOKEN_PARAM } from '@deckbase/server-core/protocol';
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

const TOKEN_KEY = 'deckbase.token';

// The server hands the token over in the URL (?t=...). Keep it for this window and hide it from the address bar.
function readToken(): string {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(TOKEN_PARAM);
  if (fromUrl) {
    try { sessionStorage.setItem(TOKEN_KEY, fromUrl); } catch { /* storage may be blocked */ }
    url.searchParams.delete(TOKEN_PARAM);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    return fromUrl;
  }
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

const token = readToken();

/** True inside the app's native window (set by the shell's init script), false in a browser. */
export const isDesktop = (window as { __DECKBASE_SHELL__?: string }).__DECKBASE_SHELL__ === 'window';

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
  let res: Response;
  try {
    res = await fetch(path + qs(params), {
      method,
      headers: { [TOKEN_HEADER]: token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new RequestError({ kind: 'offline', code: 'offline', message: t('error.offline') });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RequestError(data ?? { kind: 'internal', code: 'http', params: { status: res.status }, message: `HTTP error ${res.status}` });
  return data as T;
}
