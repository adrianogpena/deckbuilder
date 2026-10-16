import { PlatformError } from '@deckbuilderkit/platform';
import { AppError } from '@deckbuilderkit/server-core';

/** Rethrows a PlatformError as an `invalid` AppError the UI translates (`error.<code>`); anything else unchanged. */
export function fromPlatform(err: unknown): never {
  if (err instanceof PlatformError) throw new AppError('invalid', err.code, err.message, { detail: err.detail });
  throw err;
}
