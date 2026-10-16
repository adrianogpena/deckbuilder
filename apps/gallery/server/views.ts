import { join } from 'node:path';
import { appHome } from '@deckbuilder/platform';
import type { ServerViewDef } from '@deckbuilder/server-core';
import { explorerServerView } from '@deckbuilder/view-explorer/server';
import { gitServerView } from '@deckbuilder/view-git/server';
import { restServerView } from '@deckbuilder/view-rest/server';
import { terminalServerView } from '@deckbuilder/view-terminal/server';
import { workbenchServerView } from '@deckbuilder/view-workbench/server';
import { APP } from '../app.ts';
import { MULTI_DELETE_ENABLED } from '../app.ts';

/** The server half of the view list (`web/src/views.ts`): routes, sockets, settings groups and quit hooks. */
const explorer = explorerServerView({ multiDelete: MULTI_DELETE_ENABLED });

export const serverViews: ServerViewDef[] = [
  explorer,
  terminalServerView({ integrationDir: join(appHome(APP.id), 'shell-integration'), resolveCwd: explorer.resolveCwd }),
  workbenchServerView(),
  restServerView(),
  gitServerView(),
];
