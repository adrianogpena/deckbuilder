import { createElement } from 'react';
import { addMessages, createViews, groupField, oneOf, PanelLoading, type ViewIds } from '@deckbuilderkit/ui';
import { explorerView } from '@deckbuilderkit/view-explorer/web';
import { gitView } from '@deckbuilderkit/view-git/web';
import { restView } from '@deckbuilderkit/view-rest/web';
import { terminalView } from '@deckbuilderkit/view-terminal/web';
import { workbenchView } from '@deckbuilderkit/view-workbench/web';
import { agentsView } from '@deckbuilderkit/view-agents/view';
import type { Settings } from './api';
import { bindViews } from './commands';
import { dashboardPanels, dashboardView } from '@deckbuilderkit/view-grid/web';
import { settingsRegistry } from './settings';
import { MULTI_DELETE_ENABLED } from '../../app';

/** The one list the nav, routes, screens, commands, settings and messages of the gallery come from. */
export const views = createViews(
  [dashboardView({ group: 'nav.section.main', order: 35, panels: dashboardPanels }), explorerView({ group: 'nav.section.main', order: 40, multiDelete: MULTI_DELETE_ENABLED }), workbenchView({ group: 'nav.section.main', order: 50 }), restView({ group: 'nav.section.main', order: 60 }), terminalView({ group: 'nav.section.main', order: 70 }), gitView({ group: 'nav.section.main', order: 80 }), agentsView({ group: 'nav.section.main', order: 90 })],
  { fallback: createElement(PanelLoading) },
);

export type ScreenId = ViewIds<typeof views>;

views.registerSettings(settingsRegistry);
settingsRegistry.registerSettings([groupField<Settings, 'general'>('general', 'startScreen', 120, oneOf('dashboard', views.ids))]);
addMessages(views.messages);
bindViews(views);
