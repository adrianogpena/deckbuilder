import { CLOCK_SPEC } from '../clock-fields';
import type { DataSource, GridPanelSpec } from '../server';
import { sources as calendar, specs as calendarSpecs } from './calendar/server';
import { sources as daily, specs as dailySpecs } from './daily/server';
import { sources as containers, specs as containersSpecs } from './containers/server';
import { sources as feeds, specs as feedsSpecs } from './feeds/server';
import { sources as github, specs as githubSpecs } from './github/server';
import { sources as jira, specs as jiraSpecs } from './jira/server';
import { sources as meeting, specs as meetingSpecs } from './meeting/server';
import { sources as misc, specs as miscSpecs } from './misc/server';
import { sources as pods, specs as podsSpecs } from './pods/server';
import { sources as spellcheck, specs as spellcheckSpecs } from './spellcheck/server';
import { sources as spotify, specs as spotifySpecs } from './spotify/server';
import { sources as tickets, specs as ticketsSpecs } from './tickets/server';
import { sources as timesheet, specs as timesheetSpecs } from './timesheet/server';

/** Server specs of every Dashboard panel kind. */
export const dashboardSpecs: readonly GridPanelSpec[] = [
  CLOCK_SPEC, ...githubSpecs, ...jiraSpecs, ...calendarSpecs, ...feedsSpecs, ...miscSpecs,
  ...ticketsSpecs, ...podsSpecs, ...containersSpecs, ...timesheetSpecs, ...meetingSpecs, ...dailySpecs, ...spotifySpecs, ...spellcheckSpecs,
];

/** Data sources of every Dashboard panel kind. */
export const dashboardSources: readonly DataSource<any>[] = [
  ...github, ...jira, ...calendar, ...feeds, ...misc,
  ...tickets, ...pods, ...containers, ...timesheet, ...meeting, ...daily, ...spotify, ...spellcheck,
];
