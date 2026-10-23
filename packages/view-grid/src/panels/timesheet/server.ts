import { createJsonStore } from '../../json-store';
import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { applyLocks, emptyData, parseData, toggleLock, weekBounds, weekTotals, localDay, splitRoots, type TimesheetData } from './analysis';
import { collectWeek } from './collect';
import { TIMESHEET_FIELDS } from './fields';

export interface TimesheetConfig {
  roots: string;
  ticketPattern: string;
  includeCopilot: boolean;
  includeGit: boolean;
  [key: string]: unknown;
}

export interface TimesheetResult extends TimesheetData {
  /** Today, `YYYY-MM-DD`, local time. */
  today: string;
}

const storeOf = (dataDir: string) => createJsonStore<TimesheetData>({ dataDir, name: 'timesheet', parse: parseData, empty: emptyData });

/** This week's total hours per ticket, from the stored timesheet. */
export async function readWeekHours(dataDir: string): Promise<Record<string, number>> {
  const data = await storeOf(dataDir).read();
  return data.week === weekBounds(new Date()).monday ? weekTotals(data) : {};
}

async function compute(config: TimesheetConfig, dataDir: string, signal: AbortSignal): Promise<TimesheetResult> {
  const now = new Date();
  const bounds = weekBounds(now);
  const today = localDay(now);
  const fresh = await collectWeek({
    roots: splitRoots(config.roots),
    ticketPattern: config.ticketPattern,
    includeCopilot: config.includeCopilot,
    includeGit: config.includeGit,
    now,
    signal,
  });
  const data = await storeOf(dataDir).update((stored) => applyLocks(stored, fresh, bounds, today));
  return { ...data, today };
}

const timesheet = defineSource<TimesheetConfig>({
  id: 'timesheet',
  fields: TIMESHEET_FIELDS,
  fetch: (config, ctx) => compute(config, ctx.dataDir, ctx.signal),
  actions: {
    refresh: (_payload, config, ctx) => compute(config, ctx.dataDir, ctx.signal),
    'toggle-lock': async (payload, _config, ctx) => {
      const date = typeof payload === 'object' && payload !== null ? (payload as { date?: unknown }).date : undefined;
      if (typeof date !== 'string') throw new Error('date required');
      const now = new Date();
      const today = localDay(now);
      const data = await storeOf(ctx.dataDir).update((stored) => toggleLock(stored, date, weekBounds(now), today));
      return { ...data, today };
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'timesheet', fields: TIMESHEET_FIELDS, allowMultiple: false }];

export const sources: DataSource<any>[] = [timesheet];
