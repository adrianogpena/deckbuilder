import { secretStore } from '@deckbuilderkit/platform';
import { dbStores } from '@deckbuilderkit/db';
import { appStores } from '@deckbuilderkit/server-mods';
import { APP } from '../app.ts';

const secrets = secretStore(APP.id);

/** The stores of the packaged views (`ctx.stores`): projects, REST requests and environments, DB connections, histories. */
export const stores = { ...appStores(APP.id, { secrets }), ...dbStores(APP.id, { secrets }) };
