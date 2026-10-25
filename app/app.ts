import type { AppIdentity } from '@kedalion/server-core/protocol';

/**
 * Identity of the app, shared by the server, the build and the web UI.
 * When starting a new app from this one, change these first (see README "New app").
 */
export const APP: AppIdentity = {
  name: 'Kedalion',
  id: 'kedalion',
};

/**
 * Deleting several Explorer items at once. Off: the server refuses more than one path and the tree
 * disables Delete on a multi-selection. Multi-item delete crashes the app under some antivirus
 * (see `packages/platform/src/trash.ts`); flip this when that is fixed.
 */
export const MULTI_DELETE_ENABLED = false;
