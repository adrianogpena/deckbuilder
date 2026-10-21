import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { AgendaPanel, type AgendaConfig } from './Agenda';
import { CalendarPanel, type CalendarConfig } from './Calendar';
import { CountdownsPanel, type CountdownsConfig } from './Countdowns';
import { SprintPanel, type SprintConfig } from './Sprint';
import { dayKey } from './dates';
import { AGENDA_FIELDS, CALENDAR_FIELDS, COUNTDOWNS_FIELDS, SPRINT_FIELDS } from './fields';
import type { IcsEvent } from './ics';

const REFRESH_MS = 10 * 60_000;

const loadEvents = (icsUrl: string, from: string, days: number): Promise<IcsEvent[]> =>
  icsUrl.trim() ? fetchSource<IcsEvent[]>('calendar-ics', { icsUrl, from, days }) : Promise.resolve([]);

const calendarPanel = definePanel<CalendarConfig, IcsEvent[]>({
  kind: 'calendar',
  title: 'dash.calendar.panel.calendar',
  description: 'dash.calendar.panel.calendar.description',
  icon: 'plan',
  category: 'dash.category.calendar',
  size: { w: 6, h: 18, minW: 4, minH: 10 },
  config: { fields: CALENDAR_FIELDS },
  load: (config) => loadEvents(config.icsUrl, `${dayKey(new Date()).slice(0, 8)}01`, 62),
  refreshMs: REFRESH_MS,
  render: ({ config, data }) => createElement(CalendarPanel, { config, events: data ?? [] }),
});

const sprintPanel = definePanel<SprintConfig>({
  kind: 'sprint',
  title: 'dash.calendar.panel.sprint',
  description: 'dash.calendar.panel.sprint.description',
  icon: 'bookmark',
  category: 'dash.category.calendar',
  size: { w: 8, h: 6, minW: 4, minH: 4 },
  config: { fields: SPRINT_FIELDS },
  render: ({ config, configure }) => createElement(SprintPanel, { config, configure }),
});

const countdownsPanel = definePanel<CountdownsConfig>({
  kind: 'countdowns',
  title: 'dash.calendar.panel.countdowns',
  description: 'dash.calendar.panel.countdowns.description',
  icon: 'bell',
  category: 'dash.category.calendar',
  size: { w: 4, h: 8, minW: 3, minH: 4 },
  config: { fields: COUNTDOWNS_FIELDS },
  render: ({ config }) => createElement(CountdownsPanel, { config }),
});

const agendaPanel = definePanel<AgendaConfig, IcsEvent[]>({
  kind: 'agenda',
  title: 'dash.calendar.panel.agenda',
  description: 'dash.calendar.panel.agenda.description',
  icon: 'log',
  category: 'dash.category.calendar',
  size: { w: 5, h: 12, minW: 3, minH: 5 },
  config: { fields: AGENDA_FIELDS },
  load: (config) => loadEvents(config.icsUrl, dayKey(new Date()), config.days),
  refreshMs: REFRESH_MS,
  render: ({ config, data }) => createElement(AgendaPanel, { config, events: data ?? [] }),
});

/** The calendar panel kinds. */
export const panels: AnyPanelKind[] = [calendarPanel, sprintPanel, countdownsPanel, agendaPanel];
