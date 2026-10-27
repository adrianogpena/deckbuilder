import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { TIMESHEET_FIELDS } from './fields';
import { TimesheetPanel, type TimesheetPanelData } from './TimesheetPanel';

const timesheetPanel = definePanel<Record<string, unknown>, TimesheetPanelData>({
  kind: 'timesheet',
  title: 'dash.timesheet.panel',
  description: 'dash.timesheet.panel.description',
  icon: 'history',
  category: 'dash.category.timesheet',
  size: { w: 10, h: 12, minW: 6, minH: 6 },
  config: { fields: TIMESHEET_FIELDS },
  allowMultiple: false,
  load: (config, ctx) => fetchSource<TimesheetPanelData>('timesheet', config, ctx.signal),
  refreshMs: 15 * 60_000,
  render: ({ config, data, refresh }) => createElement(TimesheetPanel, { config, data, refresh }),
});

export const panels: AnyPanelKind[] = [timesheetPanel];
