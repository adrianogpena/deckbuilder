import type { AppIdentity } from '@deckbase/server-core/protocol';

/**
 * Identity of the app, shared by the server, the build and the web UI.
 * When starting a new app from this one, change these first (see README "New app").
 */
export const APP: AppIdentity = {
  name: 'Deckbase',
  id: 'deckbase',
};
