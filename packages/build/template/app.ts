import type { AppIdentity } from '@deckbuilder/server-core/protocol';

/**
 * Identity of the app, shared by the server, the build and the web UI.
 * When starting a new app from this one, change these first (see README "New app").
 */
export const APP: AppIdentity = {
  name: '__APP_NAME__',
  id: '__APP_ID__',
};
