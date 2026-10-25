import type { ApiErrorBody } from '@kedalion/server-core/protocol';
import { tryT } from './i18n';

// The parts of the API client that touch no DOM at import, so tests and other clients can use them.

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

export type QueryParams = Record<string, string | number | boolean | undefined>;

/** `?a=1&b=x`, or '' when nothing is left: undefined, '' and false are skipped, true becomes '1'. */
export function qs(params: QueryParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
