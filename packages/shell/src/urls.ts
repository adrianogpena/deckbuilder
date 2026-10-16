import { CODE_PARAM, type LaunchCodes } from '@deckbuilderkit/server-core';

/** A URL that opens the UI at `origin`, on `#<path>` when given, with a fresh launch code. */
export function launchUrl(origin: string, codes: LaunchCodes, path?: string): string {
  const url = `${origin}/?${CODE_PARAM}=${codes.issue()}`;
  return path ? `${url}#${path}` : url;
}
