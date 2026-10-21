import type { PanelField } from '@deckbuilderkit/ui/grid';
import { DEFAULT_TICKET_PATTERN, ISSUE_MODES, PR_MODES } from './map';

export const PR_COLUMNS = ['repo', 'author', 'review', 'checks', 'labels', 'branch', 'ticket', 'updated'] as const;
export const ISSUE_COLUMNS = ['repo', 'author', 'labels', 'assignees', 'comments', 'milestone', 'updated'] as const;

const connection: PanelField = { key: 'connection', kind: 'connection', connectionType: 'github', label: 'dash.github.connection', default: '' };
const repo: PanelField = { key: 'repo', kind: 'string', label: 'dash.github.repo', description: 'dash.github.repo.hint', placeholder: 'dash.github.repo.placeholder', default: '', maxLength: 100 };
const query: PanelField = { key: 'query', kind: 'string', label: 'dash.github.query', description: 'dash.github.query.hint', default: '', maxLength: 300 };
const max: PanelField = { key: 'max', kind: 'number', label: 'dash.github.max', default: 15, min: 1, max: 50 };

export const PULL_REQUESTS_FIELDS: readonly PanelField[] = [
  connection,
  { key: 'mode', kind: 'enum', label: 'dash.github.mode', default: 'mine', values: PR_MODES, optionLabel: 'dash.github.prMode' },
  repo,
  query,
  max,
  { key: 'columns', kind: 'multi', label: 'dash.github.columns', default: ['repo', 'review', 'checks', 'updated'], values: PR_COLUMNS, optionLabel: 'dash.github.col' },
  { key: 'ticketPattern', kind: 'string', label: 'dash.github.ticketPattern', description: 'dash.github.ticketPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 100 },
];

export const ISSUES_FIELDS: readonly PanelField[] = [
  connection,
  { key: 'mode', kind: 'enum', label: 'dash.github.mode', default: 'assigned', values: ISSUE_MODES, optionLabel: 'dash.github.issueMode' },
  repo,
  query,
  max,
  { key: 'columns', kind: 'multi', label: 'dash.github.columns', default: ['repo', 'labels', 'updated'], values: ISSUE_COLUMNS, optionLabel: 'dash.github.col' },
];

/** What a panel sends to the github search sources. */
export const PR_SOURCE_FIELDS: readonly PanelField[] = PULL_REQUESTS_FIELDS.filter((f) => f.key !== 'columns');
export const ISSUE_SOURCE_FIELDS: readonly PanelField[] = ISSUES_FIELDS.filter((f) => f.key !== 'columns');

/** Config field lists of the github panels (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = {
  'github-prs': PULL_REQUESTS_FIELDS,
  'github-issues': ISSUES_FIELDS,
};
