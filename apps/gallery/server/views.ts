import { homedir } from 'node:os';
import { join } from 'node:path';
import { appHome } from '@deckbuilderkit/platform';
import type { ServerViewDef } from '@deckbuilderkit/server-core';
import { explorerServerView } from '@deckbuilderkit/view-explorer/server';
import { gitServerView } from '@deckbuilderkit/view-git/server';
import { restServerView } from '@deckbuilderkit/view-rest/server';
import { terminalServerView } from '@deckbuilderkit/view-terminal/server';
import { workbenchServerView } from '@deckbuilderkit/view-workbench/server';
import { launchers, terminalSessions } from '@deckbuilderkit/terminal/server';
import { agentsLauncher, agentsServerView } from '@deckbuilderkit/view-agents/server';
import { APP } from '../app.ts';
import { MULTI_DELETE_ENABLED } from '../app.ts';

/** The server half of the view list (`web/src/views.ts`): routes, sockets, settings groups and quit hooks. */
const explorer = explorerServerView({ multiDelete: MULTI_DELETE_ENABLED });
/** Claude config home of the Agents view; the `claude` terminal launcher uses the same one. */
const agentsHome = homedir();
const terminalStore = terminalSessions();

let appLink: ((path: string) => string) | undefined;
/** Called with `StartContext.link` once the app starts; toasts from the Agents view use it as their click target. */
export const setAppLink = (link: (path: string) => string) => {
  appLink = link;
};

export const serverViews: ServerViewDef[] = [
  explorer,
  terminalServerView({ integrationDir: join(appHome(APP.id), 'shell-integration'), resolveCwd: explorer.resolveCwd, launchers: launchers({ claude: agentsLauncher({ home: agentsHome }) }), sessions: terminalStore }),
  workbenchServerView(),
  restServerView(),
  gitServerView(),
  agentsServerView({
    home: agentsHome,
    link: () => appLink,
    terminals: terminalStore,
    terminalScreens: () =>
      terminalStore
        .list()
        .flatMap((s) => (s.exited === undefined && typeof s.meta?.agentSession === 'string' ? [[s.meta.agentSession, terminalStore.screenLines(s.id, 25)] as [string, string[]]] : [])),
  }),
];
