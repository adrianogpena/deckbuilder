import { join } from 'node:path';
import { appHome } from '@deckbuilderkit/platform';
import type { ServerViewDef } from '@deckbuilderkit/server-core';
import { explorerServerView } from '@deckbuilderkit/view-explorer/server';
import { gitServerView } from '@deckbuilderkit/view-git/server';
import { restServerView } from '@deckbuilderkit/view-rest/server';
import { terminalServerView } from '@deckbuilderkit/view-terminal/server';
import { workbenchServerView } from '@deckbuilderkit/view-workbench/server';
import { agentsServerView } from '@deckbuilderkit/view-agents/server';
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
  agentsServerView(),
];
