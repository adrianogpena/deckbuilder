import { join } from 'node:path';
import { appHome } from '@deckbuilder/platform';
import type { ServerViewDef } from '@deckbuilder/server-core';
import { gitServerView } from '@deckbuilder/view-git/server';
import { restServerView } from '@deckbuilder/view-rest/server';
import { terminalServerView } from '@deckbuilder/view-terminal/server';
import { workbenchServerView } from '@deckbuilder/view-workbench/server';
import { APP } from '../app.ts';
import { resolveCwd } from './routes.ts';

/** The server half of the view list (`web/src/views.ts`): routes, sockets, settings groups and quit hooks. */
export const serverViews: ServerViewDef[] = [
  terminalServerView({ integrationDir: join(appHome(APP.id), 'shell-integration'), resolveCwd }),
  workbenchServerView(),
  restServerView(),
  gitServerView(),
];
