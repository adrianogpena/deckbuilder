import { createElement } from 'react';
import { validConfig } from '@kedalion/ui';
import { dashboardItemOf } from '../../dashboard/items';
import { definePanel, type AnyPanelKind } from '../../panel';
import { lastPanelData } from '../../PanelHost';
import { fetchSource } from '../../source';
import { TICKETS_FIELDS } from '../tickets/fields';
import type { TicketsConfig } from '../tickets/TicketsPanel';
import type { TicketsData } from '../tickets/types';
import { TIMESHEET_FIELDS } from './fields';
import type { TimesheetResult } from './server';
import { TimesheetPanel, type TimesheetPanelData } from './TimesheetPanel';

/** The Tickets panel's config and data, from its last load or, when it never loaded, a fresh one; none without a Tickets panel. */
async function boardOf(signal: AbortSignal): Promise<TimesheetPanelData['board']> {
  const item = dashboardItemOf('tickets');
  if (!item) return undefined;
  const config = validConfig(TICKETS_FIELDS, item.config) as TicketsConfig;
  const data = lastPanelData<TicketsData>(item.id, 'tickets', config) ?? (await fetchSource<TicketsData>('tickets', config, signal).catch(() => undefined));
  return data ? { config, data } : undefined;
}

const timesheetPanel = definePanel<Record<string, unknown>, TimesheetPanelData>({
  kind: 'timesheet',
  title: 'dash.timesheet.panel',
  description: 'dash.timesheet.panel.description',
  icon: 'history',
  category: 'dash.category.timesheet',
  size: { w: 10, h: 12, minW: 6, minH: 6 },
  config: { fields: TIMESHEET_FIELDS },
  allowMultiple: false,
  load: async (config, ctx) => {
    const [sheet, board] = await Promise.all([fetchSource<TimesheetResult>('timesheet', config, ctx.signal), boardOf(ctx.signal)]);
    return { ...sheet, board };
  },
  refreshMs: 15 * 60_000,
  render: ({ id, config, data, refresh, side }) => createElement(TimesheetPanel, { id, config, data, refresh, side }),
});

export const panels: AnyPanelKind[] = [timesheetPanel];
