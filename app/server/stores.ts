import { secretStore } from '@kedalion/platform';
import { dbStores } from '@kedalion/db';
import { appStores } from '@kedalion/server-mods';
import { APP } from '../app.ts';

const secrets = secretStore(APP.id);

/** The stores of the packaged views (`ctx.stores`): projects, REST requests and environments, DB connections, histories. */
export const stores = { ...appStores(APP.id, { secrets }), ...dbStores(APP.id, { secrets }) };
