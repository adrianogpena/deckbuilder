/**
 * An expected platform failure. platform has no server-core dep, so server code maps it with
 * `fromPlatform` (server-mods) to an AppError: `code` picks the UI text (`error.<code>`),
 * `detail` carries raw tool output.
 */
export class PlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}
