/**
 * Identity of the app, shared by the server, the desktop shell and the web UI.
 * When starting a new project from this skeleton, change these first (see README "Rename").
 */
export const APP = {
  /** Display name: window title, sidebar, terminal output. */
  name: 'Deckbase',
  /** Lowercase id: settings folder (~/.<id>), storage keys, token header. */
  id: 'deckbase',
} as const;

/** Header the web UI sends with the session token. */
export const TOKEN_HEADER = `x-${APP.id}-token`;
