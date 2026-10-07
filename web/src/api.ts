import { APP, TOKEN_HEADER } from '../../shared/app';
import { t, tryT, type Language } from './i18n';

export interface ApiError {
  kind: string;
  /** Message id for translation (`error.<code>`); "raw" means `message` is shown as-is. */
  code?: string;
  /** English fallback. */
  message: string;
  params?: Record<string, string | number>;
  detail?: string;
}

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

const TOKEN_KEY = `${APP.id}.token`;

// The server hands the token over in the URL (?t=...). Keep it for this window and hide it from the address bar.
function readToken(): string {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('t');
  if (fromUrl) {
    try { sessionStorage.setItem(TOKEN_KEY, fromUrl); } catch { /* storage may be blocked */ }
    url.searchParams.delete('t');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    return fromUrl;
  }
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

const token = readToken();

/** True inside the Electron desktop app. */
export const isDesktop = /\bElectron\//.test(navigator.userAgent);

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, params: Record<string, any> = {}, body?: unknown): Promise<T> {
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

export interface Settings {
  theme: 'dark' | 'light';
  language?: Language;
}

export interface Info {
  name: string;
  version: string;
  platform: string;
  arch: string;
  hostname: string;
  node: string;
  electron: string | null;
  settingsDir: string;
  startedAt: string;
}

export const api = {
  info: () => request<Info>('GET', '/api/info'),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', {}, patch),
  echo: (text: string) => request<{ text: string; length: number; at: string }>('POST', '/api/echo', {}, { text }),
};
