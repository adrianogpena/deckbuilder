import { tKey } from '../../i18n';
import { Chip, ListRows, relTime, type ListRow } from '../../kit';
import './jira.css';
import { groupIssues, type GroupBy, type JiraIssue } from './map';
import type { IssuesData } from './server';

export interface IssuesConfig {
  columns: string[];
  groupBy: GroupBy;
  [key: string]: unknown;
}

const has = (config: IssuesConfig, column: string): boolean => config.columns.includes(column);

/** The chosen columns of an issue as meta parts (status is the chip). */
export function metaOf(issue: JiraIssue, config: IssuesConfig, now: number = Date.now()): string[] {
  const parts: (string | false)[] = [
    has(config, 'type') && issue.type,
    has(config, 'priority') && issue.priority,
    has(config, 'assignee') && issue.assignee,
    has(config, 'reporter') && issue.reporter,
    has(config, 'sprint') && issue.sprint,
    has(config, 'updated') && !!issue.updated && relTime(issue.updated, now),
    has(config, 'due') && !!issue.due && tKey('dash.jira.due', { date: issue.due.slice(0, 10) }),
  ];
  return parts.filter((p): p is string => !!p);
}

const rowOf = (issue: JiraIssue, config: IssuesConfig): ListRow => ({
  id: issue.key,
  title: `${issue.key}  ${issue.summary}`,
  href: issue.url,
  chip: <Chip tone={issue.tone}>{issue.status}</Chip>,
  meta: metaOf(issue, config),
});

export function IssuesPanel({ config, data }: { config: IssuesConfig; data: IssuesData | undefined }) {
  const issues = data?.issues ?? [];
  const groups = groupIssues(issues, config.groupBy);
  return (
    <div className="jira">
      <div className="jira-head">{tKey(issues.length === 1 ? 'dash.jira.count.one' : 'dash.jira.count.other', { n: issues.length })}</div>
      <div className="jira-body">
        {config.groupBy === 'none' ? (
          <ListRows rows={issues.map((i) => rowOf(i, config))} empty={tKey('dash.jira.empty')} />
        ) : issues.length === 0 ? (
          <ListRows rows={[]} empty={tKey('dash.jira.empty')} />
        ) : (
          groups.map((g) => (
            <section key={g.key || '-'} className="jira-group">
              <h4 className="jira-group-title">{g.key || tKey('dash.jira.none')} <span className="muted">{g.issues.length}</span></h4>
              <ListRows rows={g.issues.map((i) => rowOf(i, config))} empty="" />
            </section>
          ))
        )}
      </div>
    </div>
  );
}
