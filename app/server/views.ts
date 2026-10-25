import { homedir } from 'node:os';
import { join } from 'node:path';
import { appHome, createNotifications } from '@kedalion/platform';
import { type ServerViewDef, viewIcons } from '@kedalion/server-core';
import { dashboardServerView, dashboardSources, dashboardSpecs } from '@kedalion/view-grid/server';
import { explorerServerView } from '@kedalion/view-explorer/server';
import { gitServerView } from '@kedalion/view-git/server';
import { restServerView } from '@kedalion/view-rest/server';
import { terminalServerView } from '@kedalion/view-terminal/server';
import { workbenchServerView } from '@kedalion/view-workbench/server';
import { launchers, terminalSessions } from '@kedalion/terminal/server';
import { agentsLauncher, agentsServerView } from '@kedalion/view-agents/server';
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

/** The app's one notifier (OS toasts); each view sends through `notifications.for(viewId)` and gets its icon. */
export const notifications = createNotifications({ appName: APP.name, link: () => appLink, viewIcons: (id) => viewIcons(serverViews)(id) });

export const serverViews: ServerViewDef[] = [
  explorer,
  terminalServerView({ integrationDir: join(appHome(APP.id), 'shell-integration'), resolveCwd: explorer.resolveCwd, launchers: launchers({ claude: agentsLauncher({ home: agentsHome }) }), sessions: terminalStore }),
  workbenchServerView(),
  restServerView(),
  gitServerView(),
  dashboardServerView({ panels: dashboardSpecs, sources: dashboardSources, notifications }),
  agentsServerView({
    home: agentsHome,
    link: () => appLink,
    notifications,
    terminals: terminalStore,
    terminalScreens: () =>
      terminalStore
        .list()
        .flatMap((s) => (s.exited === undefined && typeof s.meta?.agentSession === 'string' ? [[s.meta.agentSession, terminalStore.screenLines(s.id, 25)] as [string, string[]]] : [])),
  }),
];
