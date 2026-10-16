import { createElement } from 'react';
import { addMessages, createViews, groupField, oneOf, PanelLoading, type ViewIds } from '@deckbuilder/ui';
import { terminalView } from '@deckbuilder/view-terminal/web';
import type { Settings } from './api';
import { bindViews } from './commands';
import { explorerView } from './screens/explorer.view';
import { gitView } from './screens/git.view';
import { gridView } from './screens/grid.view';
import { homeView } from './screens/home.view';
import { restView } from './screens/rest.view';
import { tabsView } from './screens/tabs.view';
import { workbenchView } from './screens/workbench.view';
import { settingsRegistry } from './settings';

/** The one list the nav, routes, screens, commands, settings and messages of the gallery come from. */
export const views = createViews(
  [homeView, tabsView, gridView, explorerView, workbenchView, restView, terminalView({ group: 'nav.section.main', order: 70 }), gitView],
  { fallback: createElement(PanelLoading) },
);

export type ScreenId = ViewIds<typeof views>;

views.registerSettings(settingsRegistry);
settingsRegistry.registerSettings([groupField<Settings, 'general'>('general', 'startScreen', 120, oneOf('home', views.ids))]);
addMessages(views.messages);
bindViews(views);
