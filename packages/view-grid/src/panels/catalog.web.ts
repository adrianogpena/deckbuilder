import type { AnyPanelKind } from '../panel';
import { clockPanel } from './clock';
import { panels as calendar } from './calendar/web';
import { panels as feeds } from './feeds/web';
import { panels as github } from './github/web';
import { panels as jira } from './jira/web';
import { panels as misc } from './misc/web';

/** Every panel kind of the Dashboard view. */
export const dashboardPanels: readonly AnyPanelKind[] = [clockPanel, ...github, ...jira, ...calendar, ...feeds, ...misc];
