import type { ApiErrorBody } from './protocol.ts';

export type ErrorKind = 'invalid' | 'notfound' | 'forbidden' | 'internal';

const STATUS: Record<ErrorKind, number> = {
  invalid: 400,
  forbidden: 403,
  notfound: 404,
  internal: 500,
};

export type ErrorParams = Record<string, string | number>;

/**
 * `code` identifies the message so the UI can translate it (`error.<code>`);
 * `message` is the English fallback. Raw tool output goes in `detail` and is never translated.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    readonly opts: { detail?: string; params?: ErrorParams } = {},
  ) {
    super(message);
    this.status = STATUS[kind];
  }

  toJSON(): ApiErrorBody {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      detail: this.opts.detail ?? '',
      params: this.opts.params ?? {},
    };
  }
}

export const invalid = (code: string, message: string, params?: ErrorParams) => new AppError('invalid', code, message, { params });
export const notFound = (code: string, message: string, params?: ErrorParams) => new AppError('notfound', code, message, { params });
export const forbidden = (code: string, message: string, params?: ErrorParams) => new AppError('forbidden', code, message, { params });
