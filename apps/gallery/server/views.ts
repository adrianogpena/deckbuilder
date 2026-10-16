import { join } from 'node:path';
import { appHome } from '@deckbuilder/platform';
import { terminalServerView } from '@deckbuilder/view-terminal/server';
import { APP } from '../app.ts';
import { resolveCwd } from './routes.ts';

/** The server half of the view list (`web/src/views.ts`): routes, sockets, settings groups and quit hooks. */
export const serverViews = [
  terminalServerView({ integrationDir: join(appHome(APP.id), 'shell-integration'), resolveCwd }),
];
