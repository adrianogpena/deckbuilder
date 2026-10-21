import { CLOCK_SPEC } from '../clock-fields';
import type { DataSource, GridPanelSpec } from '../server';
import { sources as calendar, specs as calendarSpecs } from './calendar/server';
import { sources as feeds, specs as feedsSpecs } from './feeds/server';
import { sources as github, specs as githubSpecs } from './github/server';
import { sources as jira, specs as jiraSpecs } from './jira/server';
import { sources as misc, specs as miscSpecs } from './misc/server';

/** Server specs of every Dashboard panel kind. */
export const dashboardSpecs: readonly GridPanelSpec[] = [CLOCK_SPEC, ...githubSpecs, ...jiraSpecs, ...calendarSpecs, ...feedsSpecs, ...miscSpecs];

/** Data sources of every Dashboard panel kind. */
export const dashboardSources: readonly DataSource<any>[] = [...github, ...jira, ...calendar, ...feeds, ...misc];
