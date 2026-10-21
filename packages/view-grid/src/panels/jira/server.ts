import { defineSource, SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { agile, count, fieldIds, search } from './client';
import { BOARD_FIELDS, COUNT_FIELDS, fields, ISSUES_FIELDS } from './fields';
import { breakdown, mapIssue, mapSprint, requestFields, type JiraIssue, type SprintData, type Slice } from './map';

export interface IssuesData {
  issues: JiraIssue[];
}

export interface CountData {
  total: number;
  slices: Slice[];
}

const issuesSource = defineSource<{ connection: string; jql: string; max: number; columns: string[] }>({
  id: 'jira-issues',
  fields: ISSUES_FIELDS,
  async fetch({ connection, jql, max, columns }, ctx): Promise<IssuesData> {
    const conn = await ctx.connection(connection, 'jira');
    const ids = columns.includes('sprint') ? await fieldIds(conn, ctx.signal) : {};
    const raw = await search(conn, jql, requestFields(columns, ids), max, ctx.signal);
    return { issues: raw.map((r) => mapIssue(r, conn.baseUrl, ids)) };
  },
});

const countSource = defineSource<{ connection: string; jql: string; display: string }>({
  id: 'jira-count',
  fields: COUNT_FIELDS,
  async fetch({ connection, jql, display }, ctx): Promise<CountData> {
    const conn = await ctx.connection(connection, 'jira');
    const total = await count(conn, jql, ctx.signal);
    if (display !== 'status' && display !== 'assignee' && display !== 'priority') return { total, slices: [] };
    const raw = await search(conn, jql, requestFields([display]), 100, ctx.signal);
    return { total, slices: breakdown(raw.map((r) => mapIssue(r, conn.baseUrl)), display) };
  },
});

const sprintSource = defineSource<{ connection: string; boardId: number; columns: string[] }>({
  id: 'jira-sprint',
  fields: BOARD_FIELDS,
  async fetch({ connection, boardId, columns }, ctx): Promise<SprintData | null> {
    const conn = await ctx.connection(connection, 'jira');
    if (!boardId) throw SourceError('not-configured', 'No board is set.');
    const sprints = await agile(conn, `/board/${boardId}/sprint?state=active`, ctx.signal);
    const sprint = (sprints.values ?? [])[0];
    if (!sprint) return null;
    const ids = await fieldIds(conn, ctx.signal);
    const wanted = requestFields(columns, ids);
    const q = new URLSearchParams({ maxResults: '100', fields: wanted.join(',') });
    const res = await agile(conn, `/sprint/${sprint.id}/issue?${q}`, ctx.signal);
    return mapSprint(sprint, ((res.issues ?? []) as Record<string, any>[]).map((r) => mapIssue(r, conn.baseUrl, ids)));
  },
});

export const specs: GridPanelSpec[] = [
  { kind: 'jira-issues', fields: fields['jira-issues'], allowMultiple: true },
  { kind: 'jira-count', fields: fields['jira-count'], allowMultiple: true },
  { kind: 'jira-sprint', fields: fields['jira-sprint'], allowMultiple: true },
];
export const sources: DataSource<any>[] = [issuesSource, countSource, sprintSource];
