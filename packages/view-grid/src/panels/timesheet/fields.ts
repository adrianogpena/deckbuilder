import type { PanelField } from '@kedalion/ui/grid';
import { DEFAULT_TICKET_PATTERN } from '../github/map';

export const TIMESHEET_FIELDS: readonly PanelField[] = [
  { key: 'roots', kind: 'text', label: 'dash.timesheet.roots', description: 'dash.timesheet.roots.hint', default: '', rows: 4 },
  { key: 'ticketPattern', kind: 'string', label: 'dash.timesheet.ticketPattern', description: 'dash.timesheet.ticketPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 100 },
  { key: 'includeCopilot', kind: 'boolean', label: 'dash.timesheet.includeCopilot', default: true },
  { key: 'includeGit', kind: 'boolean', label: 'dash.timesheet.includeGit', default: true },
];

export const fields: Record<string, readonly PanelField[]> = {
  timesheet: TIMESHEET_FIELDS,
};
