import { createElement } from 'react';
import { addMessages, createViews, groupField, oneOf, PanelLoading, type ViewIds } from '@deckbuilderkit/ui';
import { explorerView } from '@deckbuilderkit/view-explorer/web';
import { gitView } from '@deckbuilderkit/view-git/web';
import { restView } from '@deckbuilderkit/view-rest/web';
import { terminalView } from '@deckbuilderkit/view-terminal/web';
import { workbenchView } from '@deckbuilderkit/view-workbench/web';
import type { Settings } from './api';
import { bindViews } from './commands';
import { gridView } from './screens/grid.view';
import { homeView } from './screens/home.view';
import { tabsView } from './screens/tabs.view';
import { settingsRegistry } from './settings';
import { MULTI_DELETE_ENABLED } from '../../app';
import { explorerClient, gitClient, httpClient, restClient } from './http-client';
import { sqlClient, workbenchClient } from './sql-client';

/** The one list the nav, routes, screens, commands, settings and messages of the gallery come from. */
export const views = createViews(
  [homeView, tabsView, gridView, explorerView({ group: 'nav.section.main', order: 40, client: { explorer: explorerClient, sql: sqlClient, http: httpClient }, multiDelete: MULTI_DELETE_ENABLED }), workbenchView({ group: 'nav.section.main', order: 50, client: workbenchClient }), restView({ group: 'nav.section.main', order: 60, client: restClient }), terminalView({ group: 'nav.section.main', order: 70 }), gitView({ group: 'nav.section.main', order: 80, client: gitClient })],
  { fallback: createElement(PanelLoading) },
);

export type ScreenId = ViewIds<typeof views>;

views.registerSettings(settingsRegistry);
settingsRegistry.registerSettings([groupField<Settings, 'general'>('general', 'startScreen', 120, oneOf('home', views.ids))]);
addMessages(views.messages);
bindViews(views);
