import type { PanelField } from '@deckbuilderkit/ui/grid';
import { DEFAULT_TICKET_PATTERN } from '../github/map';
import { DEFAULT_STATUSES } from './model';

export const TICKETS_FIELDS: readonly PanelField[] = [
  { key: 'statuses', kind: 'text', label: 'dash.tickets.statuses', description: 'dash.tickets.statuses.hint', default: DEFAULT_STATUSES.join('\n'), rows: 6, maxLength: 1000 },
  { key: 'keyPattern', kind: 'string', label: 'dash.tickets.keyPattern', description: 'dash.tickets.keyPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 200 },
  { key: 'jiraBaseUrl', kind: 'string', label: 'dash.tickets.jiraBaseUrl', description: 'dash.tickets.jiraBaseUrl.hint', placeholder: 'dash.tickets.jiraBaseUrl.placeholder', default: '', maxLength: 300 },
];

export const fields: Record<string, readonly PanelField[]> = { tickets: TICKETS_FIELDS };
